import { parse } from '@babel/parser';
import * as t from '@babel/types';
import { validateDocument } from '../core/document';
import { componentTypes, type ComponentType, type ImportResult, type JsonValue, type StudioDocument, type StudioNode } from '../core/types';
import { CodeDiagnosticError, diagnosticFromError, splitManagedRegion } from './boundary';

const ATTRIBUTES = new Set(['studioId', 'name', 'props', 'layout', 'responsive', 'bindings', 'events']);
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** Interpret a deliberately small AST subset. No source is evaluated. */
export function importCode(code: string, inputBase: StudioDocument): ImportResult {
  return readManagedCode(code, inputBase, true);
}

/** Internal compiler inspection can accept an earlier revision, never apply it. */
export function readManagedCode(code: string, inputBase: StudioDocument, checkRevision: boolean): ImportResult {
  let preservedBefore = '';
  let preservedAfter = '';
  let lineOffset = 0;
  const nodeLocations: Record<string, { line: number; column: number }> = {};
  let metadataLocation: { line: number; column: number } | undefined;
  try {
    const base = validateDocument(inputBase);
    const region = splitManagedRegion(code);
    preservedBefore = region.before;
    preservedAfter = region.after;
    lineOffset = region.firstLine - 1;
    const fail = (message: string, node?: { loc?: t.SourceLocation | null }, nodeId?: string, diagnosticCode = 'CODE_UNSUPPORTED'): never => {
      const location = node?.loc ? { line: node.loc.start.line + lineOffset, column: node.loc.start.column + 1 } : undefined;
      throw new CodeDiagnosticError(diagnosticCode, message, location, nodeId);
    };
    const ast = parse(region.managed, { sourceType: 'module', plugins: ['jsx', 'typescript'], errorRecovery: false });
    if (ast.comments?.length) fail('Move custom comments outside the managed region so they remain recoverable.', ast.comments[0]);
    if (ast.program.directives.length || ast.program.body.length !== 2) fail('The managed region must contain only studioMeta and StudioApp.', ast.program);

    const literal = (node: t.Node | null | undefined, depth = 0): JsonValue => {
      if (!node || depth > 40) return fail('Only bounded JSON literals are supported.', node ?? undefined);
      if (t.isStringLiteral(node) || t.isBooleanLiteral(node)) return node.value;
      if (t.isNullLiteral(node)) return null;
      if (t.isNumericLiteral(node)) {
        if (!Number.isFinite(node.value)) return fail('Numbers must be finite.', node);
        return node.value;
      }
      if (t.isUnaryExpression(node) && node.operator === '-' && t.isNumericLiteral(node.argument)) {
        if (!Number.isFinite(node.argument.value)) return fail('Numbers must be finite.', node);
        return -node.argument.value;
      }
      if (t.isArrayExpression(node)) return node.elements.map(item => literal(item, depth + 1));
      if (t.isObjectExpression(node)) {
        const result: Record<string, JsonValue> = {};
        for (const property of node.properties) {
          if (!t.isObjectProperty(property) || property.computed || property.shorthand) return fail('Object spreads, methods, computed keys and shorthand are unsupported.', property);
          const key = t.isIdentifier(property.key) ? property.key.name : t.isStringLiteral(property.key) ? property.key.value : t.isNumericLiteral(property.key) ? String(property.key.value) : null;
          if (key === null || FORBIDDEN_KEYS.has(key) || Object.hasOwn(result, key)) return fail('Object keys must be unique safe literal names.', property);
          result[key] = literal(property.value, depth + 1);
        }
        return result;
      }
      return fail('Use JSON literals, token references and declared bindings; executable expressions are unsupported.', node);
    };
    const declaration = ast.program.body[0];
    if (!t.isExportNamedDeclaration(declaration) || !t.isVariableDeclaration(declaration.declaration) || declaration.declaration.kind !== 'const' || declaration.declaration.declarations.length !== 1 || declaration.specifiers.length) fail('Declare export const studioMeta with a JSON object.', declaration);
    const metaDeclaration = (declaration as t.ExportNamedDeclaration).declaration as t.VariableDeclaration;
    const metaVariable = metaDeclaration.declarations[0];
    if (metaVariable.loc) metadataLocation = { line: metaVariable.loc.start.line + lineOffset, column: metaVariable.loc.start.column + 1 };
    if (!t.isIdentifier(metaVariable.id) || metaVariable.id.name !== 'studioMeta') fail('The metadata variable must be named studioMeta.', metaVariable);
    const annotation = (metaVariable.id as t.Identifier).typeAnnotation;
    if (annotation) {
      if (!t.isTSTypeAnnotation(annotation) || !t.isTSTypeReference(annotation.typeAnnotation) || !t.isIdentifier(annotation.typeAnnotation.typeName, { name: 'Omit' })) fail('Only the optional Omit<StudioDocument, "nodes"> metadata type annotation is supported.', metaVariable);
      const parameters = (annotation as t.TSTypeAnnotation).typeAnnotation as t.TSTypeReference;
      const params = parameters.typeParameters?.params;
      if (params?.length !== 2 || !t.isTSTypeReference(params[0]) || !t.isIdentifier(params[0].typeName, { name: 'StudioDocument' }) || params[0].typeParameters || !t.isTSLiteralType(params[1]) || !t.isStringLiteral(params[1].literal, { value: 'nodes' })) fail('Only the optional Omit<StudioDocument, "nodes"> metadata type annotation is supported.', metaVariable);
    }
    const meta = literal(metaVariable.init);
    if (!meta || Array.isArray(meta) || typeof meta !== 'object' || Object.hasOwn(meta, 'nodes')) fail('studioMeta must be document metadata without a nodes map.', metaVariable);
    const metadata = meta as Record<string, JsonValue>;
    if (metadata.id !== base.id) fail('This code belongs to another project.', metaVariable, undefined, 'CODE_PROJECT');

    const appExport = ast.program.body[1];
    if (!t.isExportNamedDeclaration(appExport) || !t.isFunctionDeclaration(appExport.declaration) || appExport.specifiers.length) fail('Declare export function StudioApp with a single catalog JSX return.', appExport);
    const app = (appExport as t.ExportNamedDeclaration).declaration as t.FunctionDeclaration;
    if (app.id?.name !== 'StudioApp' || app.params.length || app.async || app.generator || app.typeParameters || app.returnType || app.body.directives.length || app.body.body.length !== 1 || !t.isReturnStatement(app.body.body[0])) fail('StudioApp must be a parameterless function containing one JSX return.', app);
    const returned = (app.body.body[0] as t.ReturnStatement).argument;
    if (!t.isJSXElement(returned) || !t.isJSXIdentifier(returned.openingElement.name, { name: 'StudioProvider' })) fail('StudioApp must return one StudioProvider.', returned ?? app);
    const provider = returned as t.JSXElement;
    const providerAttributes = provider.openingElement.attributes;
    if (providerAttributes.length !== 1 || !t.isJSXAttribute(providerAttributes[0]) || !t.isJSXIdentifier(providerAttributes[0].name, { name: 'meta' }) || !t.isJSXExpressionContainer(providerAttributes[0].value) || !t.isIdentifier(providerAttributes[0].value.expression, { name: 'studioMeta' })) fail('StudioProvider accepts only meta={studioMeta}.', provider);

    const nodes: Record<string, StudioNode> = {};
    const children = (element: t.JSXElement, nodeId?: string): t.JSXElement[] => {
      const result: t.JSXElement[] = [];
      for (const child of element.children) {
        if (t.isJSXText(child) && child.value.trim() === '') continue;
        if (!t.isJSXElement(child)) fail('Nest catalog components only; put visible text in Text props.', child, nodeId);
        result.push(child as t.JSXElement);
      }
      return result;
    };
    const visit = (element: t.JSXElement, depth: number): string => {
      if (depth > 100 || Object.keys(nodes).length >= 2_000) fail('The component tree exceeds the supported size or nesting limit.', element);
      const identityAttribute = element.openingElement.attributes.find(attr => t.isJSXAttribute(attr) && t.isJSXIdentifier(attr.name, { name: 'studioId' }));
      const identityValue = identityAttribute && t.isJSXAttribute(identityAttribute) ? identityAttribute.value : null;
      const identity = t.isStringLiteral(identityValue) ? identityValue.value : t.isJSXExpressionContainer(identityValue) && t.isStringLiteral(identityValue.expression) ? identityValue.expression.value : undefined;
      if (identity && element.loc) nodeLocations[identity] = { line: element.loc.start.line + lineOffset, column: element.loc.start.column + 1 };
      const tag = element.openingElement.name;
      if (!t.isJSXIdentifier(tag) || !componentTypes.includes(tag.name as ComponentType)) fail('Use a component from the Studio catalog.', element, identity);
      const attributes: Record<string, JsonValue> = {};
      for (const attr of element.openingElement.attributes) {
        if (!t.isJSXAttribute(attr) || !t.isJSXIdentifier(attr.name) || !ATTRIBUTES.has(attr.name.name)) fail('Only declared catalog attributes are supported; spreads and custom event handlers are refused.', attr, identity);
        const attribute = attr as t.JSXAttribute;
        const name = (attribute.name as t.JSXIdentifier).name;
        if (Object.hasOwn(attributes, name)) fail(`Duplicate attribute ${name}.`, attr);
        if (t.isStringLiteral(attribute.value)) attributes[name] = attribute.value.value;
        else if (t.isJSXExpressionContainer(attribute.value)) attributes[name] = literal(attribute.value.expression);
        else fail(`Attribute ${name} needs a literal value.`, attr);
      }
      if (typeof attributes.studioId !== 'string' || !attributes.studioId) fail('Every node needs a unique literal studioId.', element);
      const id = attributes.studioId as string;
      if (Object.hasOwn(nodes, id)) fail(`The stable identity ${id} appears more than once.`, element, id, 'CODE_DUPLICATE_ID');
      const node: StudioNode = {
        id, type: (tag as t.JSXIdentifier).name as ComponentType,
        name: (attributes.name ?? (tag as t.JSXIdentifier).name) as string,
        props: (attributes.props ?? {}) as StudioNode['props'], layout: (attributes.layout ?? {}) as StudioNode['layout'],
        responsive: (attributes.responsive ?? {}) as StudioNode['responsive'],
        bindings: (attributes.bindings ?? {}) as StudioNode['bindings'], events: (attributes.events ?? {}) as StudioNode['events'], children: [],
      };
      nodes[id] = node;
      node.children = children(element, id).map(child => visit(child, depth + 1));
      return id;
    };
    const roots = children(provider);
    if (roots.length !== 1) fail('StudioProvider must contain exactly one root Frame.', provider);
    const rootId = visit(roots[0], 0);
    if (metadata.rootId !== rootId) fail('The root studioId must match studioMeta.rootId.', roots[0], rootId);
    const document = validateDocument({ ...metadata, nodes });
    if (checkRevision && metadata.revision !== base.revision) fail(`This draft is based on revision ${String(metadata.revision)}; the document is now revision ${base.revision}. Review the current changes before reapplying.`, metaVariable, undefined, 'CODE_STALE');
    return { document, diagnostics: [], preservedBefore, preservedAfter };
  } catch (error) {
    const diagnostic = diagnosticFromError(error, lineOffset);
    if (diagnostic.nodeId && !diagnostic.line) Object.assign(diagnostic, nodeLocations[diagnostic.nodeId]);
    if (!diagnostic.line) Object.assign(diagnostic, metadataLocation);
    if (!diagnostic.nodeId && diagnostic.line) {
      const preceding = Object.entries(nodeLocations).filter(([, location]) => location.line <= diagnostic.line!).sort((a, b) => b[1].line - a[1].line)[0];
      if (preceding) diagnostic.nodeId = preceding[0];
    }
    return { document: null, diagnostics: [diagnostic], preservedBefore, preservedAfter };
  }
}
