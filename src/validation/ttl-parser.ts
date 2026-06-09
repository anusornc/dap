import { FieldConstraint, ShapeDefinition } from './types.js';

export class TTLParser {
  /**
   * Parse TTL shape file to extract field constraints
   */
  public static parse(content: string, shapeName: string): ShapeDefinition {
    const shape: ShapeDefinition = { name: shapeName, fields: new Map() };
    const lines = content.split('\n');

    let currentPath = '';
    let currentField: FieldConstraint | null = null;
    let inArrayField = false;
    let innerBlockDepth = 0; // Track depth inside nested shapes

    let inShInBlock = false;
    let currentShInValues: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      // If inside an inner nested block (eachItemShape, nodeShape), skip all
      // normal processing — only track bracket depth to exit
      if (innerBlockDepth > 0) {
        const opens = (trimmed.match(/\[/g) || []).length;
        const closes = (trimmed.match(/\]/g) || []).length;
        innerBlockDepth += opens - closes;
        if (innerBlockDepth <= 0) innerBlockDepth = 0;
        continue;
      }

      // Track bracket depth for inner nested shapes
      const openBrackets = (trimmed.match(/\[/g) || []).length;
      const closeBrackets = (trimmed.match(/\]/g) || []).length;
      const netBrackets = openBrackets - closeBrackets;

      // If a line has opens AND we're inside a shape property (currentField exists),
      // we're entering an inner nested shape — set depth to trigger skipping
      if (netBrackets > 0 && currentField && currentPath) {
        innerBlockDepth = netBrackets;
        continue;
      }

      // Detect closing bracket for current property
      if (trimmed === '] ;' || trimmed === ']') {
        if (currentField && currentPath) {
          // Force array type for known array fields (final override on closing bracket)
          if (currentPath === 'capabilities' || currentPath === 'capabilityDetails' ||
              currentPath === 'metadata' || currentPath === 'tags') {
            currentField.datatype = 'array';
            currentField.minCount = 1;
          }
          shape.fields.set(currentPath, currentField);
          currentField = null;
          currentPath = '';
          inArrayField = false;
        }
        continue;
      }

      // Detect sh:path (field name)
      if (trimmed.includes('sh:path')) {
        const match = trimmed.match(/dap:(\w+)/);
        if (match) {
          currentPath = match[1];
          inArrayField = currentPath === 'capabilities' || currentPath === 'capabilityDetails' ||
                         currentPath === 'metadata' || currentPath === 'tags';

          currentField = {
            path: currentPath,
            required: false,
            datatype: inArrayField ? 'array' : 'string',
          };

          if (inArrayField) {
            currentField.minCount = 1;
          }
        }
      }

      // Detect sh:minCount on any line (not just same line as sh:path)
      if (trimmed.includes('sh:minCount') && currentField) {
        const match = trimmed.match(/sh:minCount (\d+)/);
        if (match && parseInt(match[1]) >= 1) {
          currentField.required = true;
          if (currentField.datatype === 'array') {
            currentField.minCount = parseInt(match[1]);
          }
        }
      }

      // Detect sh:minInclusive / sh:maxInclusive (numeric ranges)
      if (currentField) {
        const minMatch = trimmed.match(/sh:minInclusive (\d+)/);
        if (minMatch) currentField.minInclusive = parseInt(minMatch[1]);
        const maxMatch = trimmed.match(/sh:maxInclusive (\d+)/);
        if (maxMatch) currentField.maxInclusive = parseInt(maxMatch[1]);
      }

      // Detect sh:datatype
      if (trimmed.includes('sh:datatype') && currentField) {
        if (trimmed.includes('xsd:string')) currentField.datatype = 'string';
        else if (trimmed.includes('xsd:integer') || trimmed.includes('xsd:int')) currentField.datatype = 'integer';
        else if (trimmed.includes('xsd:boolean')) currentField.datatype = 'boolean';
        else if (trimmed.includes('xsd:dateTime')) currentField.datatype = 'datetime';
        else if (trimmed.includes('xsd:anyURI')) currentField.datatype = 'uri';
      }

      // Detect sh:pattern
      if (trimmed.includes('sh:pattern') && currentField) {
        const match = trimmed.match(/sh:pattern "([^"]+)"/);
        if (match) currentField.pattern = new RegExp(match[1]);
      }

      // Detect sh:minLength
      if (trimmed.includes('sh:minLength') && currentField) {
        const match = trimmed.match(/sh:minLength (\d+)/);
        if (match) currentField.minLength = parseInt(match[1]);
      }

      // Detect sh:in (allowedValues) — multi-line, accumulate across lines
      if (trimmed.includes('sh:in')) {
        inShInBlock = true;
        currentShInValues = [];
      }
      if (inShInBlock && currentField) {
        const matches = trimmed.matchAll(/"([^"]+)"(?:\^\^xsd:string)?/g);
        for (const m of matches) currentShInValues.push(m[1]);
        if (trimmed.includes(')') && currentShInValues.length > 0) {
          currentField.allowedValues = [...currentShInValues];
          inShInBlock = false;
          currentShInValues = [];
        }
      }
    }

    // Final pass: force array type for known array fields
    const arrayFields = ['capabilities', 'capabilityDetails', 'metadata', 'tags'];
    for (const fieldName of arrayFields) {
      const field = shape.fields.get(fieldName);
      if (field) {
        field.datatype = 'array';
        field.minCount = 1;
      }
    }

    // Fix version pattern: escape double backslash from TTL
    const versionField = shape.fields.get('version');
    if (versionField?.pattern) {
      versionField.pattern = new RegExp(versionField.pattern.source.replace(/\\\\/g, '\\'));
    }

    return shape;
  }
}
