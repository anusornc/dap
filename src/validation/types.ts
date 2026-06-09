export interface ValidationError {
  path: string;
  message: string;
  severity: 'error' | 'warning';
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  shape: string;
}

export interface FieldConstraint {
  path: string;
  required: boolean;
  datatype?: string;
  pattern?: RegExp;
  minCount?: number;
  maxCount?: number;
  minLength?: number;
  minInclusive?: number;
  maxInclusive?: number;
  valueRange?: { min?: number; max?: number };
  allowedValues?: string[];
  eachItemShape?: FieldConstraint;
  _innerBlock?: boolean; // Internal flag to track nested shape depth
}

export interface ShapeDefinition {
  name: string;
  fields: Map<string, FieldConstraint>;
}
