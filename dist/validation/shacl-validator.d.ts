/**
 * SHACL-like Validator
 * TypeScript-based validation that mirrors SHACL semantics
 * Parses shapes/*.ttl to extract field constraints, validates JSON data directly
 */
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
/**
 * SHACL-like Validator
 * Loads and validates data against TTL shape definitions
 */
export declare class SHACLValidator {
    private shapes;
    private shapesDir;
    private _inShInBlock;
    private _currentShInValues;
    constructor(shapesDir?: string);
    /**
     * Load and parse all TTL shape files
     */
    private loadShapes;
    /**
     * Check if shapes have been loaded
     */
    hasShapes(): boolean;
    /**
     * Parse TTL shape file to extract field constraints
     */
    private parseTTL;
    /**
     * Create default shapes from known type definitions
     */
    private createDefaultShapes;
    /**
     * Validate agent registration data
     */
    validateAgent(data: any): ValidationResult;
    /**
     * Validate DAP message data
     */
    validateMessage(data: any): ValidationResult;
    /**
     * Validate job record data
     */
    validateJob(data: any): ValidationResult;
    /**
     * Core validation logic
     */
    private validate;
    /**
     * Validate field datatype
     */
    private validateType;
    /**
     * Check if string is a valid URI
     */
    private isValidURI;
    /**
     * Get loaded shapes info
     */
    getShapeInfo(): {
        name: string;
        fieldCount: number;
    }[];
}
export declare function getValidator(shapesDir?: string): SHACLValidator;
//# sourceMappingURL=shacl-validator.d.ts.map