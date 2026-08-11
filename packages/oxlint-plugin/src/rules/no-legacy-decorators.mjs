// Disallows legacy Angular property/method decorators that have modern signal-based
// or metadata-based replacements:
//   @Input()          → input() / input.required()
//   @Output()         → output()
//   @ViewChild()      → viewChild() / viewChild.required()
//   @ViewChildren()   → viewChildren()
//   @ContentChild()   → contentChild() / contentChild.required()
//   @ContentChildren()→ contentChildren()
//   @HostBinding()    → host metadata property
//   @HostListener()   → host metadata property

const DECORATOR_CONFIG = {
  Input: {
    messageId: 'noInputDecorator',
    fixable: true,
  },
  Output: {
    messageId: 'noOutputDecorator',
    fixable: true,
  },
  ViewChild: {
    messageId: 'noViewChildDecorator',
    fixable: true,
  },
  ViewChildren: {
    messageId: 'noViewChildrenDecorator',
    fixable: true,
  },
  ContentChild: {
    messageId: 'noContentChildDecorator',
    fixable: true,
  },
  ContentChildren: {
    messageId: 'noContentChildrenDecorator',
    fixable: true,
  },
  HostBinding: {
    messageId: 'noHostBindingDecorator',
    fixable: false,
  },
  HostListener: {
    messageId: 'noHostListenerDecorator',
    fixable: false,
  },
};

export default {
  meta: {
    type: 'suggestion',
    fixable: 'code',
    docs: {
      description:
        'Enforce modern Angular signal-based APIs instead of legacy decorators (@Input, @Output, @ViewChild, @ViewChildren, @ContentChild, @ContentChildren, @HostBinding, @HostListener)',
    },
    messages: {
      noInputDecorator:
        'Use input() or model() instead of @Input(). Signal inputs integrate with Angular reactivity.',
      noOutputDecorator:
        'Use output() instead of @Output(). Signal outputs integrate with Angular reactivity.',
      noViewChildDecorator:
        'Use viewChild() or viewChild.required() instead of @ViewChild(). Signal queries integrate with Angular reactivity.',
      noViewChildrenDecorator:
        'Use viewChildren() instead of @ViewChildren(). Signal queries integrate with Angular reactivity.',
      noContentChildDecorator:
        'Use contentChild() or contentChild.required() instead of @ContentChild(). Signal queries integrate with Angular reactivity.',
      noContentChildrenDecorator:
        'Use contentChildren() instead of @ContentChildren(). Signal queries integrate with Angular reactivity.',
      noHostBindingDecorator:
        "Use the 'host' metadata property in @Component/@Directive instead of @HostBinding().",
      noHostListenerDecorator:
        "Use the 'host' metadata property in @Component/@Directive instead of @HostListener().",
    },
  },
  create(context) {
    const checkDecorators = (node) => {
      if (!node.decorators || node.decorators.length === 0) return;

      for (const decorator of node.decorators) {
        const expr = decorator.expression;

        const name =
          expr.type === 'CallExpression' && expr.callee.type === 'Identifier'
            ? expr.callee.name
            : expr.type === 'Identifier'
              ? expr.name
              : null;

        const config = name ? DECORATOR_CONFIG[name] : null;
        if (!config) continue;

        const report = {
          node: decorator,
          messageId: config.messageId,
        };

        if (config.fixable) {
          report.fix = (fixer) =>
            buildFix(name, fixer, node, decorator, context);
        }

        context.report(report);
      }
    };

    return {
      PropertyDefinition: checkDecorators,
      MethodDefinition: checkDecorators,
    };
  },
};

const buildFix = (decoratorName, fixer, node, decorator, context) => {
  switch (decoratorName) {
    case 'Input':
      return buildInputFix(fixer, node, decorator, context);
    case 'Output':
      return buildOutputFix(fixer, node, decorator, context);
    case 'ViewChild':
      return buildQueryFix('viewChild', true, fixer, node, decorator, context);
    case 'ViewChildren':
      return buildQueryFix(
        'viewChildren',
        false,
        fixer,
        node,
        decorator,
        context,
      );
    case 'ContentChild':
      return buildQueryFix(
        'contentChild',
        true,
        fixer,
        node,
        decorator,
        context,
      );
    case 'ContentChildren':
      return buildQueryFix(
        'contentChildren',
        false,
        fixer,
        node,
        decorator,
        context,
      );
    default:
      return null;
  }
};

/**
 * Transforms `@Input() name = 'default'` → `readonly name = input('default')`
 * Transforms `@Input() name!: string` → `readonly name = input.required<string>()`
 * Transforms `@Input({required: true}) name!: string` → `readonly name = input.required<string>()`
 */
const buildInputFix = (fixer, node, decorator, context) => {
  const sourceCode = context.getSourceCode();
  const propName = node.key.type === 'Identifier' ? node.key.name : null;
  if (!propName) return null;

  const decoratorExpr = decorator.expression;
  const decoratorArgs =
    decoratorExpr.type === 'CallExpression' ? decoratorExpr.arguments : [];

  const isRequiredViaDecorator = decoratorArgs.some(
    (arg) =>
      arg.type === 'ObjectExpression' &&
      arg.properties.some(
        (prop) =>
          prop.type === 'Property' &&
          prop.key.type === 'Identifier' &&
          prop.key.name === 'required' &&
          prop.value.type === 'Literal' &&
          prop.value.value === true,
      ),
  );

  const optionsObj = decoratorArgs.find(
    (arg) => arg.type === 'ObjectExpression',
  );
  let alias = null;
  let transform = null;

  if (optionsObj && optionsObj.type === 'ObjectExpression') {
    const aliasProp = optionsObj.properties.find(
      (prop) =>
        prop.type === 'Property' &&
        prop.key.type === 'Identifier' &&
        prop.key.name === 'alias',
    );
    if (aliasProp && aliasProp.value.type === 'Literal') {
      alias = aliasProp.value.value;
    }

    const transformProp = optionsObj.properties.find(
      (prop) =>
        prop.type === 'Property' &&
        prop.key.type === 'Identifier' &&
        prop.key.name === 'transform',
    );
    if (transformProp) {
      transform = sourceCode.getText(transformProp.value);
    }
  }

  // Also check if the first arg is a plain string (alias shorthand): @Input('aliasName')
  if (
    !alias &&
    decoratorArgs.length > 0 &&
    decoratorArgs[0].type === 'Literal' &&
    typeof decoratorArgs[0].value === 'string'
  ) {
    alias = decoratorArgs[0].value;
  }

  const hasTypeAnnotation = node.typeAnnotation != null;
  const typeText = hasTypeAnnotation
    ? sourceCode.getText(node.typeAnnotation.typeAnnotation)
    : null;
  const hasValue = node.value != null;
  const valueText = hasValue ? sourceCode.getText(node.value) : null;

  const isRequired = isRequiredViaDecorator || (node.definite && !hasValue);

  const optionsParts = [];
  if (alias) optionsParts.push(`alias: '${alias}'`);
  if (transform) optionsParts.push(`transform: ${transform}`);
  const optionsText =
    optionsParts.length > 0 ? `{ ${optionsParts.join(', ')} }` : null;

  let replacement;
  if (isRequired) {
    const typeParam = typeText ? `<${typeText}>` : '';
    const optionsArg = optionsText ? optionsText : '';
    replacement = `readonly ${propName} = input.required${typeParam}(${optionsArg})`;
  } else if (hasValue) {
    const args = [valueText, optionsText].filter(Boolean).join(', ');
    replacement = `readonly ${propName} = input(${args})`;
  } else {
    const typeParam = typeText ? `<${typeText}>` : '';
    const optionsArg = optionsText ? optionsText : '';
    replacement = `readonly ${propName} = input${typeParam}(${optionsArg})`;
  }

  return fixer.replaceText(node, replacement);
};

/**
 * Transforms `@Output() click = new EventEmitter<void>()` → `readonly click = output<void>()`
 */
const buildOutputFix = (fixer, node, decorator, context) => {
  const sourceCode = context.getSourceCode();
  const propName = node.key.type === 'Identifier' ? node.key.name : null;
  if (!propName) return null;

  const decoratorExpr = decorator.expression;
  const decoratorArgs =
    decoratorExpr.type === 'CallExpression' ? decoratorExpr.arguments : [];

  // Check for alias: @Output('aliasName') or @Output({ alias: 'name' })
  let alias = null;
  if (
    decoratorArgs.length > 0 &&
    decoratorArgs[0].type === 'Literal' &&
    typeof decoratorArgs[0].value === 'string'
  ) {
    alias = decoratorArgs[0].value;
  }

  let typeParam = '';
  if (node.value) {
    const valueText = sourceCode.getText(node.value);
    const match = valueText.match(/EventEmitter<(.+)>\s*\(/);
    if (match) {
      typeParam = `<${match[1]}>`;
    }
  } else if (node.typeAnnotation) {
    const typeText = sourceCode.getText(node.typeAnnotation.typeAnnotation);
    const match = typeText.match(/EventEmitter<(.+)>/);
    if (match) {
      typeParam = `<${match[1]}>`;
    }
  }

  const optionsArg = alias ? `{ alias: '${alias}' }` : '';
  const replacement = `readonly ${propName} = output${typeParam}(${optionsArg})`;
  return fixer.replaceText(node, replacement);
};

/**
 * Transforms @ViewChild('ref') el!: ElementRef → readonly el = viewChild.required<ElementRef>('ref')
 * Transforms @ViewChildren(ChildComponent) items!: QueryList<ChildComponent> → readonly items = viewChildren(ChildComponent)
 */
const buildQueryFix = (
  fnName,
  supportsRequired,
  fixer,
  node,
  decorator,
  context,
) => {
  const sourceCode = context.getSourceCode();
  const propName = node.key.type === 'Identifier' ? node.key.name : null;
  if (!propName) return null;

  const decoratorExpr = decorator.expression;
  const decoratorArgs =
    decoratorExpr.type === 'CallExpression' ? decoratorExpr.arguments : [];

  // First arg is the query selector (string ref or component class)
  const selectorArg = decoratorArgs[0];
  const selectorText = selectorArg ? sourceCode.getText(selectorArg) : null;

  // Extract options like { read: ElementRef, static: true }
  const optionsArg = decoratorArgs.find(
    (arg) => arg.type === 'ObjectExpression',
  );
  let readType = null;
  if (optionsArg && optionsArg.type === 'ObjectExpression') {
    const readProp = optionsArg.properties.find(
      (prop) =>
        prop.type === 'Property' &&
        prop.key.type === 'Identifier' &&
        prop.key.name === 'read',
    );
    if (readProp) {
      readType = sourceCode.getText(readProp.value);
    }
  }

  // Determine type parameter from the type annotation
  // e.g., `el!: ElementRef` or `items!: QueryList<FooComponent>`
  let typeParam = '';
  if (node.typeAnnotation) {
    const typeText = sourceCode.getText(node.typeAnnotation.typeAnnotation);
    // QueryList<T> → extract T
    const queryListMatch = typeText.match(/QueryList<(.+)>/);
    if (queryListMatch) {
      typeParam = `<${queryListMatch[1]}>`;
    } else {
      typeParam = `<${typeText}>`;
    }
  }

  // Determine if required (definite assignment `!:` with no default)
  const isRequired = supportsRequired && node.definite && !node.value;

  // Build the function call arguments
  const callArgs = [];
  if (selectorText) callArgs.push(selectorText);
  if (readType) callArgs.push(`{ read: ${readType} }`);

  const fnCall = isRequired
    ? `${fnName}.required${typeParam}(${callArgs.join(', ')})`
    : `${fnName}${typeParam}(${callArgs.join(', ')})`;

  const replacement = `readonly ${propName} = ${fnCall}`;
  return fixer.replaceText(node, replacement);
};
