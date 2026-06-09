/**
 * SHACL-like Validator
 * TypeScript-based validation that mirrors SHACL semantics
 * Parses shapes/*.ttl to extract field constraints, validates JSON data directly
 */

import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { TTLParser } from './ttl-parser.js';
import { ValidationError, ValidationResult, ShapeDefinition } from './types.js';

export { ValidationError, ValidationResult };

/**
 * SHACL-like Validator
 * Loads and validates data against TTL shape definitions
 */
export class SHACLValidator {
  private shapes: Map<string, ShapeDefinition> = new Map();
  private shapesDir: string;

  constructor(shapesDir: string = './shapes') {
    this.shapesDir = shapesDir;
    this.loadShapes();
  }

  /**
   * Load and parse all TTL shape files
   */
  private loadShapes(): void {
    const shapeFiles = [
      { file: 'agent-shape.ttl', name: 'agent-shape' },
      { file: 'message-shape.ttl', name: 'message-shape' },
      { file: 'job-shape.ttl', name: 'job-shape' },
    ];

    for (const { file, name } of shapeFiles) {
      const path = resolve(this.shapesDir, file);
      if (existsSync(path)) {
        try {
          const content = readFileSync(path, 'utf-8');
          const shape = TTLParser.parse(content, name);
          this.shapes.set(name, shape);
          console.log(`[SHACLValidator] Loaded ${name} with ${shape.fields.size} fields`);
        } catch (err) {
          console.error(`[SHACLValidator] Failed to load ${file}:`, err);
        }
      }
    }

    // Fallback: create shapes from types if TTL not found
    if (this.shapes.size === 0) {
      this.createDefaultShapes();
    }
  }

  /**
   * Check if shapes have been loaded
   */
  hasShapes(): boolean {
    return this.shapes.size > 0;
  }

  /**
   * Create default shapes from known type definitions
   */
  private createDefaultShapes(): void {
    // Agent registration shape
    const agentShape: ShapeDefinition = {
      name: 'agent-shape',
      fields: new Map([
        ['agent_id', { path: 'agent_id', required: true, datatype: 'string', pattern: /^[a-zA-Z0-9_-]+$/ }],
        ['machine', { path: 'machine', required: false, datatype: 'string' }],
        ['os', { path: 'os', required: false, datatype: 'string' }],
        ['capabilities', { path: 'capabilities', required: true, datatype: 'array', minCount: 1 }],
        ['capabilityDetails', { path: 'capabilityDetails', required: false, datatype: 'array' }],
        ['version', { path: 'version', required: false, datatype: 'string' }],
        ['metadata', { path: 'metadata', required: false, datatype: 'object' }],
      ]),
    };
    this.shapes.set('agent-shape', agentShape);

    // Message shape
    const messageShape: ShapeDefinition = {
      name: 'message-shape',
      fields: new Map([
        ['id', { path: 'id', required: true, datatype: 'string' }],
        ['action', { path: 'action', required: true, datatype: 'string' }],
        ['from', { path: 'from', required: true, datatype: 'string' }],
        ['to', { path: 'to', required: true, datatype: 'object' }],
        ['payload', { path: 'payload', required: false, datatype: 'object' }],
        ['timestamp', { path: 'timestamp', required: false, datatype: 'string' }],
      ]),
    };
    this.shapes.set('message-shape', messageShape);

    // Job shape
    const jobShape: ShapeDefinition = {
      name: 'job-shape',
      fields: new Map([
        ['id', { path: 'id', required: true, datatype: 'string' }],
        ['type', { path: 'type', required: true, datatype: 'string' }],
        ['title', { path: 'title', required: true, datatype: 'string' }],
        ['description', { path: 'description', required: false, datatype: 'string' }],
        ['priority', { path: 'priority', required: false, datatype: 'string', allowedValues: ['low', 'normal', 'high', 'urgent'] }],
        ['status', { path: 'status', required: true, datatype: 'string', allowedValues: ['pending', 'claimed', 'in-progress', 'completed', 'failed', 'cancelled'] }],
        ['submitter', { path: 'submitter', required: true, datatype: 'string' }],
        ['claimant', { path: 'claimant', required: false, datatype: 'string' }],
        ['capabilities', { path: 'capabilities', required: false, datatype: 'array' }],
        ['deadline', { path: 'deadline', required: false, datatype: 'string' }],
        ['metadata', { path: 'metadata', required: false, datatype: 'object' }],
        ['provenance', { path: 'provenance', required: false, datatype: 'object' }],
      ]),
    };
    this.shapes.set('job-shape', jobShape);

    console.log('[SHACLValidator] Created default shapes from type definitions');
  }

  /**
   * Validate agent registration data
   */
  validateAgent(data: any): ValidationResult {
    return this.validate('agent-shape', data);
  }

  /**
   * Validate DAP message data
   */
  validateMessage(data: any): ValidationResult {
    return this.validate('message-shape', data);
  }

  /**
   * Validate job record data
   */
  validateJob(data: any): ValidationResult {
    return this.validate('job-shape', data);
  }

  /**
   * Core validation logic
   */
  private validate(shapeName: string, data: any): ValidationResult {
    const shape = this.shapes.get(shapeName);
    const errors: ValidationError[] = [];

    if (!shape) {
      return {
        valid: true,
        errors: [],
        shape: shapeName,
      };
    }

    for (const [fieldName, constraint] of shape.fields.entries()) {
      const value = data[fieldName];

      // Check required fields
      if (constraint.required && (value === undefined || value === null || value === '')) {
        errors.push({
          path: fieldName,
          message: `${fieldName} is required and must not be empty`,
          severity: 'error',
        });
        continue;
      }

      // Skip validation if field not present and not required
      if (value === undefined || value === null) continue;

      // For array fields, check minCount first (before type check)
      if (constraint.datatype === 'array') {
        if (!Array.isArray(value)) {
          errors.push({
            path: fieldName,
            message: `${fieldName} must be an array`,
            severity: 'error',
          });
        } else if (constraint.minCount !== undefined && value.length < constraint.minCount) {
          errors.push({
            path: fieldName,
            message: `${fieldName} must contain at least ${constraint.minCount} item(s)`,
            severity: 'error',
          });
        }
        continue; // Skip other checks for arrays
      }

      // Check datatype (for non-array fields)
      if (constraint.datatype) {
        const typeError = this.validateType(fieldName, value, constraint.datatype);
        if (typeError) {
          errors.push(typeError);
          continue;
        }
      }

      // Check pattern
      if (constraint.pattern && typeof value === 'string') {
        if (!constraint.pattern.test(value)) {
          errors.push({
            path: fieldName,
            message: `${fieldName} must match pattern ${constraint.pattern}`,
            severity: 'error',
          });
        }
      }

      // Check minLength
      if (constraint.minLength !== undefined && typeof value === 'string') {
        if (value.length < constraint.minLength) {
          errors.push({
            path: fieldName,
            message: `${fieldName} must be at least ${constraint.minLength} characters`,
            severity: 'error',
          });
        }
      }

      // Check numeric range (minInclusive / maxInclusive)
      if ((constraint.minInclusive !== undefined || constraint.maxInclusive !== undefined) && typeof value === 'number') {
        if (constraint.minInclusive !== undefined && value < constraint.minInclusive) {
          errors.push({
            path: fieldName,
            message: `${fieldName} must be >= ${constraint.minInclusive}`,
            severity: 'error',
          });
        }
        if (constraint.maxInclusive !== undefined && value > constraint.maxInclusive) {
          errors.push({
            path: fieldName,
            message: `${fieldName} must be <= ${constraint.maxInclusive}`,
            severity: 'error',
          });
        }
      }

      // Check allowedValues
      if (constraint.allowedValues && !constraint.allowedValues.includes(value)) {
        errors.push({
          path: fieldName,
          message: `${fieldName} must be one of: ${constraint.allowedValues.join(', ')}`,
          severity: 'error',
        });
      }

      // Check value range
      if (constraint.valueRange && typeof value === 'number') {
        if (constraint.valueRange.min !== undefined && value < constraint.valueRange.min) {
          errors.push({
            path: fieldName,
            message: `${fieldName} must be at least ${constraint.valueRange.min}`,
            severity: 'error',
          });
        }
        if (constraint.valueRange.max !== undefined && value > constraint.valueRange.max) {
          errors.push({
            path: fieldName,
            message: `${fieldName} must be at most ${constraint.valueRange.max}`,
            severity: 'error',
          });
        }
      }
    }

    return {
      valid: errors.filter(e => e.severity === 'error').length === 0,
      errors,
      shape: shapeName,
    };
  }

  /**
   * Validate field datatype
   */
  private validateType(fieldName: string, value: any, datatype: string): ValidationError | null {
    switch (datatype) {
      case 'string':
        if (typeof value !== 'string') {
          return { path: fieldName, message: `${fieldName} must be a string`, severity: 'error' };
        }
        break;
      case 'integer':
        if (!Number.isInteger(value)) {
          return { path: fieldName, message: `${fieldName} must be an integer`, severity: 'error' };
        }
        break;
      case 'boolean':
        if (typeof value !== 'boolean') {
          return { path: fieldName, message: `${fieldName} must be a boolean`, severity: 'error' };
        }
        break;
      case 'datetime':
        if (typeof value !== 'string' || isNaN(Date.parse(value))) {
          return { path: fieldName, message: `${fieldName} must be a valid ISO 8601 datetime`, severity: 'error' };
        }
        break;
      case 'uri':
        if (typeof value !== 'string' || !this.isValidURI(value)) {
          return { path: fieldName, message: `${fieldName} must be a valid URI`, severity: 'error' };
        }
        break;
      case 'array':
        if (!Array.isArray(value)) {
          return { path: fieldName, message: `${fieldName} must be an array`, severity: 'error' };
        }
        break;
      case 'object':
        if (typeof value !== 'object' || Array.isArray(value)) {
          return { path: fieldName, message: `${fieldName} must be an object`, severity: 'error' };
        }
        break;
    }
    return null;
  }

  /**
   * Check if string is a valid URI
   */
  private isValidURI(str: string): boolean {
    try {
      new URL(str);
      return true;
    } catch {
      // Check for valid relative URIs
      return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(str) || /^\/[^\/]/.test(str);
    }
  }

  /**
   * Get loaded shapes info
   */
  getShapeInfo(): { name: string; fieldCount: number }[] {
    return Array.from(this.shapes.entries()).map(([name, shape]) => ({
      name,
      fieldCount: shape.fields.size,
    }));
  }
}

// Singleton instance
let validatorInstance: SHACLValidator | null = null;

export function getValidator(shapesDir?: string): SHACLValidator {
  if (!validatorInstance) {
    validatorInstance = new SHACLValidator(shapesDir);
  }
  return validatorInstance;
}