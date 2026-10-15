//! MCP catalog (TASK-22 Tier C) — `app_data_dir/config/mcp-servers.json`.
//!
//! Single source of truth for MCP servers (AionUi `IMcpServer[]` analogue).
//! Shape matches `packages/acp/src/mcp.ts:parseMcpCatalog`:
//! `{ version:1, servers:[{id,transport,target,enabled,env?}] }`.
//! Env literal `ACP_MCP_SERVERS` still wins as override (tests/smoke).
//! Commands let the UI manage the file without restarting.
//!
//! The sidecar never reads this file: `resolve_acp_mcp_servers` folds enabled
//! entries into the literal, so the per-server `env` map (TASK-96) has to ride
//! the `|KEY=VAL;KEY2=VAL2` suffix that `packages/acp/src/mcp.ts:parseMcpServers`
//! understands. Dropping it here silently drops it from every session.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpCatalogServer {
    pub id: String,
    pub target: String,
    pub transport: String,
    pub enabled: bool,
    /// Extra environment for THIS server's stdio child only (TASK-96) — e.g.
    /// `JLPT_MCP_DEBUG` for the debug-tool gate in `crates/jlpt-mcp`. Optional
    /// so old catalog files and UI invokes without the key keep working.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub env: Option<HashMap<String, String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpCatalog {
    pub servers: Vec<McpCatalogServer>,
    pub version: u8,
}

impl Default for McpCatalog {
    fn default() -> Self {
        Self {
            servers: Vec::new(),
            version: 1,
        }
    }
}

fn catalog_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("config").join("mcp-servers.json")
}

fn is_valid_transport(t: &str) -> bool {
    t == "stdio" || t == "http" || t == "sse"
}

/// Shell-legal variable name: leading letter or `_`, then alphanumerics.
/// Mirrors `ENV_KEY` in `packages/acp/src/mcp.ts`.
fn is_valid_env_key(k: &str) -> bool {
    let mut chars = k.chars();
    match chars.next() {
        Some(c) if c == '_' || c.is_ascii_alphabetic() => {}
        _ => return false,
    }
    chars.all(|c| c == '_' || c.is_ascii_alphanumeric())
}

/// A value can't carry the two delimiters the literal form is split on, nor
/// control characters (which would let one value forge a second entry).
/// Mirrors `ILLEGAL_ENV_VALUE` in `packages/acp/src/mcp.ts`.
fn is_illegal_env_value(v: &str) -> bool {
    v.contains('|') || v.contains(';') || v.chars().any(char::is_control)
}

fn validate_env(env: &HashMap<String, String>) -> Result<(), String> {
    for (k, v) in env {
        if !is_valid_env_key(k) {
            return Err(format!("invalid env key {}", k));
        }
        if is_illegal_env_value(v) {
            return Err(format!("invalid env value for key {}", k));
        }
    }
    Ok(())
}

fn validate_catalog(cat: &McpCatalog) -> Result<(), String> {
    if cat.version != 1 {
        return Err(format!("unsupported catalog version {}", cat.version));
    }
    for s in &cat.servers {
        if s.id.trim().is_empty() || s.target.trim().is_empty() {
            return Err(format!("invalid server entry id={} target empty", s.id));
        }
        if !is_valid_transport(&s.transport) {
            return Err(format!("invalid transport {}", s.transport));
        }
        if let Some(env) = &s.env {
            validate_env(env)?;
        }
    }
    Ok(())
}

pub fn load_catalog(app_data_dir: &Path) -> McpCatalog {
    let path = catalog_path(app_data_dir);
    if !path.exists() {
        return McpCatalog::default();
    }
    let raw = match std::fs::read_to_string(&path) {
        Ok(v) => v,
        Err(_) => return McpCatalog::default(),
    };
    let parsed: Result<McpCatalog, _> = serde_json::from_str(&raw);
    match parsed {
        Ok(cat) if validate_catalog(&cat).is_ok() => cat,
        _ => McpCatalog::default(),
    }
}

fn save_catalog(app_data_dir: &Path, cat: &McpCatalog) -> Result<(), String> {
    let path = catalog_path(app_data_dir);
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(cat).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())
}

/// Render one catalog entry as an `ACP_MCP_SERVERS` element, appending the
/// `|KEY=VAL;KEY2=VAL2` env suffix when the entry declares one (TASK-96).
/// Sorted so the rendered literal is stable across boots.
fn render_entry(s: &McpCatalogServer) -> String {
    let mut entry = format!(
        "{}:{}:{}",
        s.id,
        s.transport,
        quote_stdio_target(&s.target, &s.transport)
    );
    if let Some(env) = s.env.as_ref().filter(|e| !e.is_empty()) {
        let mut pairs: Vec<String> = env.iter().map(|(k, v)| format!("{}={}", k, v)).collect();
        pairs.sort();
        entry.push('|');
        entry.push_str(&pairs.join(";"));
    }
    entry
}

/// Wrap a stdio target in quotes when it contains whitespace (TASK-177).
///
/// `packages/acp` splits a stdio target on whitespace into command + args, so
/// the installed Windows path `C:\Program Files\manobu\jlpt-mcp-….exe` arrived
/// as the command `C:\Program` and every session lost the vocab tools with no
/// error anywhere. A quoted first token is the one spelling that survives the
/// `,`/`:`/`|` grammar of the literal; `http`/`sse` targets are URLs and go
/// through untouched. A target carrying a literal `"` is not supported by the
/// grammar and is passed through unchanged rather than half-escaped.
fn quote_stdio_target(target: &str, transport: &str) -> String {
    let wants_quotes = transport == "stdio"
        && target.chars().any(char::is_whitespace)
        && !target.contains('"')
        && !target.starts_with('"');
    if wants_quotes {
        format!("\"{target}\"")
    } else {
        target.to_string()
    }
}

/// Resolve the effective `ACP_MCP_SERVERS` value: catalog file wins when it
/// has at least one enabled entry, otherwise the bundled `jlpt-mcp` fallback.
pub fn resolve_acp_mcp_servers(
    app_data_dir: &Path,
    fallback_bin: Option<PathBuf>,
) -> Option<String> {
    // Env literal wins — handled in lib.rs before calling this.
    let catalog = load_catalog(app_data_dir);
    let enabled: Vec<_> = catalog.servers.iter().filter(|s| s.enabled).collect();
    if !enabled.is_empty() {
        let lit = enabled
            .iter()
            .map(|s| render_entry(s))
            .collect::<Vec<_>>()
            .join(",");
        return Some(lit);
    }
    fallback_bin.map(|p| {
        format!(
            "jlpt-vocab:stdio:{}",
            quote_stdio_target(&p.display().to_string(), "stdio")
        )
    })
}

// ---------------------------------------------------------------------------
// Tauri-managed state for catalog mutations (shares app_data_dir path)
// ---------------------------------------------------------------------------

#[derive(Clone)]
pub struct McpCatalogState {
    app_data_dir: Arc<PathBuf>,
    cache: Arc<Mutex<McpCatalog>>,
}

impl McpCatalogState {
    pub fn new(app_data_dir: PathBuf) -> Self {
        let catalog = load_catalog(&app_data_dir);
        Self {
            app_data_dir: Arc::new(app_data_dir),
            cache: Arc::new(Mutex::new(catalog)),
        }
    }

    fn refresh(&self) {
        let cat = load_catalog(&self.app_data_dir);
        if let Ok(mut g) = self.cache.lock() {
            *g = cat;
        }
    }

    pub fn list(&self) -> Vec<McpCatalogServer> {
        self.refresh();
        self.cache
            .lock()
            .map(|g| g.servers.clone())
            .unwrap_or_default()
    }

    pub fn upsert(&self, server: McpCatalogServer) -> Result<(), String> {
        if server.id.trim().is_empty() || server.target.trim().is_empty() {
            return Err("id and target required".to_string());
        }
        if !is_valid_transport(&server.transport) {
            return Err(format!("invalid transport {}", server.transport));
        }
        let mut cat = load_catalog(&self.app_data_dir);
        if let Some(existing) = cat.servers.iter_mut().find(|s| s.id == server.id) {
            *existing = server;
        } else {
            cat.servers.push(server);
        }
        validate_catalog(&cat)?;
        save_catalog(&self.app_data_dir, &cat)?;
        if let Ok(mut g) = self.cache.lock() {
            *g = cat;
        }
        Ok(())
    }

    pub fn remove(&self, id: &str) -> Result<bool, String> {
        let mut cat = load_catalog(&self.app_data_dir);
        let before = cat.servers.len();
        cat.servers.retain(|s| s.id != id);
        let removed = before != cat.servers.len();
        if removed {
            save_catalog(&self.app_data_dir, &cat)?;
            if let Ok(mut g) = self.cache.lock() {
                *g = cat;
            }
        }
        Ok(removed)
    }
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn mcp_catalog_list(state: tauri::State<McpCatalogState>) -> Vec<McpCatalogServer> {
    state.list()
}

#[tauri::command]
pub fn mcp_catalog_upsert(
    state: tauri::State<McpCatalogState>,
    server: McpCatalogServer,
) -> Result<(), String> {
    state.upsert(server)
}

#[tauri::command]
pub fn mcp_catalog_remove(
    state: tauri::State<McpCatalogState>,
    id: String,
) -> Result<bool, String> {
    state.remove(&id)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("manobu-mcp-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn server(env: Option<HashMap<String, String>>) -> McpCatalogServer {
        McpCatalogServer {
            enabled: true,
            env,
            id: "jlpt-vocab".to_string(),
            target: "/bin/jlpt-mcp".to_string(),
            transport: "stdio".to_string(),
        }
    }

    #[test]
    fn env_rides_the_literal_as_a_sorted_suffix() {
        let entry = server(Some(HashMap::from([
            ("ZOO".to_string(), "2".to_string()),
            ("JLPT_MCP_DEBUG".to_string(), "1".to_string()),
        ])));
        assert_eq!(
            render_entry(&entry),
            "jlpt-vocab:stdio:/bin/jlpt-mcp|JLPT_MCP_DEBUG=1;ZOO=2"
        );
    }

    #[test]
    fn an_entry_without_env_keeps_the_legacy_shape() {
        assert_eq!(
            render_entry(&server(None)),
            "jlpt-vocab:stdio:/bin/jlpt-mcp"
        );
        assert_eq!(
            render_entry(&server(Some(HashMap::new()))),
            "jlpt-vocab:stdio:/bin/jlpt-mcp"
        );
    }

    /// A stdio target with a space would otherwise reach `packages/acp` as the
    /// command `C:\Program` (it splits the target on whitespace), which is the
    /// install dir of every per-machine Windows build.
    #[test]
    fn a_stdio_target_with_spaces_is_quoted() {
        let mut entry = server(None);
        entry.target = r"C:\Program Files\manobu\jlpt-mcp-x86_64-pc-windows-msvc.exe".to_string();
        assert_eq!(
            render_entry(&entry),
            r#"jlpt-vocab:stdio:"C:\Program Files\manobu\jlpt-mcp-x86_64-pc-windows-msvc.exe""#
        );
    }

    #[test]
    fn quoting_leaves_alone_what_the_grammar_cannot_carry() {
        // Already quoted by the user: do not nest.
        assert_eq!(
            quote_stdio_target(r#""C:\Program Files\a.exe""#, "stdio"),
            r#""C:\Program Files\a.exe""#
        );
        // A literal quote cannot be escaped inside the literal grammar.
        assert_eq!(quote_stdio_target(r#""a b.exe""#, "stdio"), r#""a b.exe""#);
        // No whitespace, nothing to protect.
        assert_eq!(
            quote_stdio_target("/bin/jlpt-mcp", "stdio"),
            "/bin/jlpt-mcp"
        );
        // A URL is not a command line: its target goes through verbatim.
        assert_eq!(
            quote_stdio_target("http://localhost:3001/mcp?a b", "http"),
            "http://localhost:3001/mcp?a b"
        );
    }

    /// The bundled fallback is the path most Windows installs actually take, so
    /// it must be quoted by the same rule as a catalog entry.
    #[test]
    fn the_bundled_fallback_quotes_a_spaces_path() {
        let dir = temp_dir("fallback-spaces");
        let bin = dir.join("jlpt with space");
        std::fs::create_dir_all(&bin).unwrap();
        let literal = resolve_acp_mcp_servers(&dir, Some(bin.clone()))
            .unwrap_or_else(|| panic!("fallback should render"));
        assert!(
            literal.starts_with("jlpt-vocab:stdio:\""),
            "unquoted target would split on the space: {literal}"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn resolve_renders_catalog_env_into_the_literal() {
        let dir = temp_dir("resolve");
        save_catalog(
            &dir,
            &McpCatalog {
                servers: vec![server(Some(HashMap::from([(
                    "JLPT_MCP_DEBUG".to_string(),
                    "1".to_string(),
                )])))],
                version: 1,
            },
        )
        .unwrap();
        assert_eq!(
            resolve_acp_mcp_servers(&dir, None).unwrap(),
            "jlpt-vocab:stdio:/bin/jlpt-mcp|JLPT_MCP_DEBUG=1"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_catalog_env_key_must_be_a_shell_legal_name() {
        assert!(is_valid_env_key("JLPT_MCP_DEBUG"));
        assert!(is_valid_env_key("_PRIVATE"));
        assert!(!is_valid_env_key(""));
        assert!(!is_valid_env_key("9LIVES"));
        assert!(!is_valid_env_key("HAS SPACE"));
        assert!(!is_valid_env_key("HAS-DASH"));
    }

    #[test]
    fn an_env_value_cannot_forge_a_second_entry() {
        assert!(is_illegal_env_value("a|b"));
        assert!(is_illegal_env_value("a;b"));
        assert!(is_illegal_env_value("a\nb"));
        assert!(!is_illegal_env_value("/usr/bin:/opt/bin"));
        let bad = server(Some(HashMap::from([(
            "JLPT_MCP_DEBUG".to_string(),
            "1;2".to_string(),
        )])));
        assert!(validate_catalog(&McpCatalog {
            servers: vec![bad],
            version: 1
        })
        .is_err());
    }

    #[test]
    fn a_catalog_with_bad_env_loads_as_empty() {
        let dir = temp_dir("bad-env");
        std::fs::create_dir_all(dir.join("config")).unwrap();
        std::fs::write(
            dir.join("config").join("mcp-servers.json"),
            r#"{"version":1,"servers":[{"id":"jlpt-vocab","transport":"stdio","target":"/bin/jlpt-mcp","enabled":true,"env":{"JLPT_MCP_DEBUG":"1|2"}}]}"#,
        )
        .unwrap();
        assert!(load_catalog(&dir).servers.is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
