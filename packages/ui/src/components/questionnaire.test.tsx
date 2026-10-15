/**
 * <Questionnaire> compound smoke suite (TASK-79.4).
 *
 * Static-render contract in the style of picker.test.tsx: the compound is
 * reference-equal to the flat exports, and a Root+Item+Title+Choices+Choice+
 * Input+Actions+Submit tree renders the data-slot hooks the question card and
 * its E2E checks depend on.
 */

import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  Questionnaire,
  QuestionnaireActions,
  QuestionnaireChoice,
  QuestionnaireChoices,
  QuestionnaireInput,
  QuestionnaireItem,
  QuestionnaireSubmit,
  QuestionnaireTitle,
} from "./questionnaire";

describe("Questionnaire.* reference-equal to flat exports", () => {
  test("compound members match flat names", () => {
    expect(Questionnaire.Actions).toBe(QuestionnaireActions);
    expect(Questionnaire.Choice).toBe(QuestionnaireChoice);
    expect(Questionnaire.Choices).toBe(QuestionnaireChoices);
    expect(Questionnaire.Input).toBe(QuestionnaireInput);
    expect(Questionnaire.Item).toBe(QuestionnaireItem);
    expect(Questionnaire.Submit).toBe(QuestionnaireSubmit);
    expect(Questionnaire.Title).toBe(QuestionnaireTitle);
  });
});

describe("Questionnaire static render", () => {
  const html = renderToStaticMarkup(
    <Questionnaire
      items={[{ choices: [{ value: "a" }], name: "q0", required: true }]}
    >
      <Questionnaire.Item name="q0" required>
        <Questionnaire.Title>Which level?</Questionnaire.Title>
        <Questionnaire.Choices>
          <Questionnaire.Choice value="a">N5</Questionnaire.Choice>
          <Questionnaire.Input
            aria-label="Another answer"
            placeholder="Type another answer…"
          />
        </Questionnaire.Choices>
      </Questionnaire.Item>
      <Questionnaire.Actions>
        <Questionnaire.Submit>Answer</Questionnaire.Submit>
      </Questionnaire.Actions>
    </Questionnaire>
  );

  test("renders the questionnaire form root", () => {
    expect(html).toContain('data-slot="questionnaire"');
    expect(html).toContain("<form");
  });
  test("renders title, choice label, and choice input", () => {
    expect(html).toContain("Which level?");
    expect(html).toContain('data-slot="questionnaire-choice-input"');
    expect(html).toContain("N5");
  });
  test("renders the free-text input with its accessible name", () => {
    expect(html).toContain('aria-label="Another answer"');
    expect(html).toContain('data-slot="questionnaire-input"');
  });
  test("renders the submit button", () => {
    expect(html).toContain('data-slot="questionnaire-submit"');
    expect(html).toContain("Answer");
  });
});
