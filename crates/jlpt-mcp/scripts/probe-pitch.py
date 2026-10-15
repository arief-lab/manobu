import json, subprocess, sys

proc = subprocess.Popen(
    ["./target/debug/jlpt-mcp"],
    stdin=subprocess.PIPE,
    stdout=subprocess.PIPE,
    stderr=subprocess.PIPE,
    text=True,
)

def rpc(method, params, _id=[0]):
    _id[0] += 1
    msg = json.dumps({"jsonrpc":"2.0","id":_id[0],"method":method,"params":params}) + "\n"
    proc.stdin.write(msg)
    proc.stdin.flush()
    while True:
        line = proc.stdout.readline()
        if not line:
            return None
        line = line.strip()
        if not line:
            continue
        resp = json.loads(line)
        if resp.get("id") == _id[0]:
            return resp
        if "error" in resp:
            raise RuntimeError(resp["error"])

rpc("initialize", {"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"probe","version":"0"}})
sys.stderr.write("initialized\n")
rpc("notifications/initialized", {})
sys.stderr.write("notified\n")

resp = rpc("tools/call", {"name":"search_pitch_accent","arguments":{"query":"はし","limit":5}})
result = resp.get("result",{})
content = result.get("content",[])
for c in content:
    if c.get("type") == "text":
        data = json.loads(c["text"])
        print("search_pitch_accent(はし) →")
        for e in data:
            print(f"  {e['word']} ({e['reading']}) pitch={e['pitchPositions']}")
        break
