/** The untyped packages bpmn-cli's engine rules import: camunda-compat's configs, rules and helpers, bpmnlint-utils and bpmnlint's rules. */

declare module 'bpmnlint-utils' {
  /** Inheritance-aware moddle type test. An unqualified type is read as `bpmn:<type>`. */
  export function is(node: unknown, type: string): boolean;
  export function isAny(node: unknown, types: string[]): boolean;
}


declare module 'bpmnlint/rules/*' {
  const rule: unknown;
  export default rule;
}

declare module 'bpmnlint-plugin-camunda-compat' {
  /** The plugin index — `configs` is plain data keyed by `<platform>-<version>`. */
  const plugin: {
    configs: Record<string, { rules?: Record<string, unknown>; extends?: string | string[] }>;
    rules: Record<string, unknown>;
  };
  export default plugin;
}

/** Every camunda-compat rule module (camunda-cloud/* and camunda-platform/*). */
declare module 'bpmnlint-plugin-camunda-compat/rules/*' {
  const rule: unknown;
  export default rule;
}


/** camunda-compat's report helper: reports each error on `node`, adding the element's name. */
declare module 'bpmnlint-plugin-camunda-compat/rules/utils/reporter.js' {
  export function reportErrors(
    node: unknown,
    reporter: { report(id: string, message: string, details?: object): void },
    errors: CompatError | CompatError[],
  ): void;

  /** One problem as camunda-compat describes it: its message, the path to it, its error type. */
  export interface CompatError {
    message: string;
    path?: (string | number)[] | null;
    data: { type: string; [key: string]: unknown };
    [key: string]: unknown;
  }
}

/** camunda-compat's error types, the `data.type` of every report (`camunda.propertyRequired`, ...). */
declare module 'bpmnlint-plugin-camunda-compat/rules/utils/error-types.js' {
  export const ERROR_TYPES: Readonly<{
    CHILD_ELEMENT_OF_TYPE_REQUIRED: string;
    CHILD_ELEMENT_TYPE_NOT_ALLOWED: string;
    CONNECTORS_PROPERTY_VALUE_NOT_ALLOWED: string;
    ELEMENT_COLLAPSED_NOT_ALLOWED: string;
    ELEMENT_MULTIPLE_NOT_ALLOWED: string;
    ELEMENT_TYPE_NOT_ALLOWED: string;
    ELEMENT_PROPERTY_VALUE_DUPLICATED: string;
    EVENT_BASED_GATEWAY_TARGET_NOT_ALLOWED: string;
    EXPRESSION_NOT_ALLOWED: string;
    EXPRESSION_REQUIRED: string;
    EXPRESSION_VALUE_NOT_ALLOWED: string;
    EXTENSION_ELEMENT_NOT_ALLOWED: string;
    EXTENSION_ELEMENT_REQUIRED: string;
    FEEL_EXPRESSION_INVALID: string;
    FEEL_EXPRESSION_UNSUPPORTED_FUNCTION: string;
    LOOP_NOT_ALLOWED: string;
    ATTACHED_TO_REF_ELEMENT_TYPE_NOT_ALLOWED: string;
    PROPERTY_DEPENDENT_REQUIRED: string;
    PROPERTY_NOT_ALLOWED: string;
    PROPERTY_DEPRECATED: string;
    PROPERTY_REQUIRED: string;
    PROPERTY_TYPE_NOT_ALLOWED: string;
    PROPERTY_VALUE_DUPLICATED: string;
    PROPERTY_VALUES_DUPLICATED: string;
    PROPERTY_VALUE_NOT_ALLOWED: string;
    PROPERTY_VALUE_REQUIRED: string;
    SECRET_EXPRESSION_FORMAT_DEPRECATED: string;
    SECRET_EXPRESSION_FORMAT_LEGACY: string;
    SECRET_REFERENCE_STRING_LITERAL_NOT_ALLOWED: string;
    SECRET_REFERENCE_INSIDE_LIST_NOT_ALLOWED: string;
    SECRET_REFERENCE_INSIDE_IF_BRANCH_CONTEXT_NOT_ALLOWED: string;
    AGENT_FEEL_FUNCTION_NAME_INVALID: string;
    AGENT_FEEL_KEY_MISSING: string;
    AGENT_FEEL_KEY_TYPE_INVALID: string;
    AGENT_FEEL_KEY_PREFIX_MISSING: string;
    AGENT_FEEL_DESCRIPTION_TYPE_INVALID: string;
    AGENT_FEEL_WRONG_CONTEXT: string;
    AGENT_FEEL_KEY_SEGMENTS_INVALID: string;
    AGENT_FEEL_KEY_DUPLICATE: string;
    AGENT_FEEL_NON_ENTRY_ELEMENT: string;
    AGENT_TOOL_OUTPUT_KEY_INVALID: string;
    AGENT_TOOL_OUTPUT_KEY_CASING_INVALID: string;
    AGENT_TOOL_OUTPUT_KEY_OVERWRITE: string;
    AGENT_TOOL_RESULT_MISSING: string;
    AGENT_TOOL_DOCUMENTATION_MISSING: string;
  }>;
}

/** camunda-compat's element checks, returning errors for `reportErrors`. */
