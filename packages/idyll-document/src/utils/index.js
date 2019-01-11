const values = require('object.values');
const entries = require('object.entries');
const falafel = require('falafel');
const {
  getChildren,
  getNodeName,
  getProperties,
  getType,
  setChildren,
  hasChildren,
  filterNodes,
  filterChildren,
  removeNodesByName
} = require('idyll-ast');
export const buildExpression = (acc, expr, key, context, isEventHandler) => {
  return `
    ((context) => {
        var __idyllStateProxy = new Proxy({}, {
          get: (_, prop) => {
            return context[prop];
          },
          set: (_, prop, value) => {
            var newState = {};
            newState[prop] = value;
            context.update(newState);
            return true;
          }
        })
        ${falafel(
          isEventHandler
            ? expr
            : `var __idyllReturnValue = ${expr || 'undefined'}`,
          node => {
            switch (node.type) {
              case 'Identifier':
                if (Object.keys(acc).indexOf(node.name) > -1) {
                  node.update('__idyllStateProxy.' + node.source());
                }
                break;
            }
          }
        )};
        ${isEventHandler ? '' : 'return __idyllReturnValue;'}
    })(this)
  `;
};

export const evalExpression = (acc, expr, key, context) => {
  const isEventHandler =
    key && (key.match(/^on[A-Z].*/) || key.match(/^handle[A-Z].*/));
  let e = buildExpression(acc, expr, key, context, isEventHandler);

  if (isEventHandler) {
    return function() {
      eval(e);
    }.bind(Object.assign({}, acc, context || {}));
  }

  try {
    return function(evalString) {
      try {
        return eval('(' + evalString + ')');
      } catch (err) {}
    }.call(Object.assign({}, acc, context || {}), e);
  } catch (err) {}
};

export const getVars = (arr, context = {}, evalContext) => {
  const formatAccumulatedValues = acc => {
    const ret = {};
    Object.keys(acc).forEach(key => {
      const accVal = acc[key];
      if (
        typeof accVal.update !== 'undefined' &&
        typeof accVal.value !== 'undefined'
      ) {
        ret[key] = accVal.value;
      } else {
        ret[key] = accVal;
      }
    });
    return ret;
  };

  const pluck = (acc, val) => {
    const variableType = getType(val);
    const attrs = getProperties(val) || [];

    if (!attrs.name || !attrs.value) return attrs;

    const nameValue = attrs.name.value;
    const valueType = attrs.value.type;
    const valueValue = attrs.value.value;

    switch (valueType) {
      case 'value':
        acc[nameValue] = valueValue;
        break;
      case 'variable':
        if (context.hasOwnProperty(valueValue)) {
          acc[nameValue] = context[valueValue];
        } else {
          acc[nameValue] = evalExpression(context, expr);
        }
        break;
      case 'expression':
        const expr = valueValue;
        if (variableType === 'var') {
          acc[nameValue] = evalExpression(
            Object.assign({}, context, formatAccumulatedValues(acc)),
            expr
          );
        } else {
          acc[nameValue] = {
            value: evalExpression(
              Object.assign({}, context, formatAccumulatedValues(acc)),
              expr
            ),
            update: (newState, oldState, context = {}) => {
              return evalExpression(
                Object.assign({}, oldState, newState, context),
                expr
              );
            }
          };
        }
    }
    return acc;
  };

  return arr.reduce(pluck, {});
};

export const filterIdyllProps = (props, filterInjected) => {
  const {
    __vars__,
    __expr__,
    hasHook,
    isHTMLNode,
    refName,
    onEnterViewFully,
    onEnterView,
    onExitViewFully,
    onExitView,
    ...rest
  } = props;
  if (filterInjected) {
    const { idyll, hasError, updateProps, ...ret } = rest;
    return ret;
  }
  return rest;
};
export const getData = (arr, datasets = {}) => {
  const pluck = (acc, val) => {
    const nameValue = getProperties(val).name.value;
    acc[nameValue] = datasets[nameValue];

    return acc;
  };

  return arr.reduce(pluck, {});
};

export const splitAST = ast => {
  const state = {
    vars: [],
    derived: [],
    data: [],
    elements: []
  };

  const handleNode = storeElements => {
    return node => {
      const type = getType(node);
      const props = getProperties(node);
      const children = getChildren(node);
      if (node.id != 0) {
        if (type === 'var') {
          state.vars.push(node);
        } else if (state[type]) {
          state[type].push(node);
        } else if (storeElements) {
          state.elements.push(node);
        }
        if (
          !children ||
          (children.length === 1 && getType(children[0]) === 'textnode')
        ) {
          return;
        }
        children.forEach(handleNode(false));
      }
    };
  };
  ast.forEach(handleNode(true));
  return state;
};

//Properties that add logic to components for callbacks.
export const hooks = [
  'onEnterView',
  'onEnterViewFully',
  'onExitView',
  'onExitViewFully'
];

export const scrollMonitorEvents = {
  onEnterView: 'enterViewport',
  onEnterViewFully: 'fullyEnterViewport',
  onExitView: 'partiallyExitViewport',
  onExitViewFully: 'exitViewport'
};

export const translate = ast => {
  const attrConvert = props => {
    let reducedProps = {};
    for (let propName in props) {
      const name = propName;
      const type = props[propName].type;
      const value = props[propName].value;
      if (type == 'variable') {
        if (!reducedProps.__vars__) {
          reducedProps.__vars__ = {};
        }
        reducedProps.__vars__[name] = value;
      }
      if (type == 'expression') {
        if (!reducedProps.__expr__) {
          reducedProps.__expr__ = {};
        }
        reducedProps.__expr__[name] = value;
      }

      if (hooks.includes(name)) {
        reducedProps.hasHook = true;
      }

      reducedProps[name] = value;
    }
    return reducedProps;
  };
  const tNode = node => {
    if (getType(node) === 'textnode') return node;

    let name = getNodeName(node);

    let attrs = getProperties(node);
    if (!attrs) {
      attrs = {};
    }
    const children = getChildren(node);
    return {
      component: name,
      ...attrConvert(attrs),
      children: children.map(tNode)
    };
  };

  return splitAST(getChildren(ast)).elements.map(tNode);
};

export const mapTree = (tree, mapFn, filterFn = () => true) => {
  const walkFn = (acc, node) => {
    //To check for textnodes
    if (node.component) {
      //To check for childrens
      if (node.children) {
        node.children = node.children.reduce(walkFn, []);
      }
    }

    if (filterFn(node)) {
      acc.push(mapFn(node));
    }
    return acc;
  };
  let value = tree.reduce(walkFn, []);
  return value;
};

export const filterASTForDocument = ast => {
  return removeNodesByName(ast, 'meta');
};

export const findWrapTargets = (schema, state, components) => {
  //Custom components
  const targets = [];
  //Name of custom components
  const componentNames = Object.keys(components);
  componentNames.forEach((component, i) => {
    let words = component.split('-');
    for (let i = 0; i < words.length; i++) {
      words[i] = words[i].charAt(0).toUpperCase() + words[i].substring(1);
    }
    componentNames[i] = words.join('').toLowerCase();
  });

  //Array of keys for the runtime state passed.
  const stateKeys = Object.keys(state);

  //Populating target with the custom componenets
  //Walk the whole tree, collect and return the nodes
  //for wrapping
  mapTree(schema, node => {
    if (node.component == 'textnode') {
      return node;
    }

    //Custom components will have hooks attached to them
    if (node.hasHook) {
      targets.push(node);
      return node;
    }

    if (node.component) {
      if (componentNames.includes(node.component.toLowerCase())) {
        targets.push(node);
        return node;
      }
    }

    const { component, children, __vars__, __expr__, ...props } = node;

    const expressions = Object.keys(__expr__ || {});
    const variables = Object.keys(__vars__ || {});

    for (let prop in props) {
      if (targets.includes(node)) {
        return;
      }

      if (variables.includes(prop) || expressions.includes(prop)) {
        targets.push(node);
      }
    }
    return node;
  });

  return targets;
};
