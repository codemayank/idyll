import React from 'react';
import Runtime from './runtime';
import compile from 'idyll-compiler';
import * as layouts from 'idyll-layouts';
import * as themes from 'idyll-themes';

const getLayout = layout => {
  return layouts[layout.trim()] || {};
};

const getTheme = theme => {
  return themes[theme.trim()] || {};
};

const defaultAST = {
  id: 0,
  type: 'component',
  name: 'root'
};

export const hashCode = str => {
  var hash = 0,
    i,
    chr;
  if (str.length === 0) return hash;
  for (i = 0; i < str.length; i++) {
    chr = str.charCodeAt(i);
    hash = (hash << 5) - hash + chr;
    hash |= 0; // Convert to 32bit integer
  }
  return hash;
};

class IdyllDocument extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      ast: props.ast || defaultAST,
      previousAST: props.ast || defaultAST,
      hash: '',
      error: null
    };
  }

  createStyleNode(str) {
    var node = document.createElement('style');
    node.innerHTML = str;
    document.body.appendChild(node);
    return node;
  }

  componentDidMount() {
    if (!this.props.ast && this.props.markup) {
      compile(this.props.markup, this.props.compilerOptions).then(ast => {
        this.setState({ ast, hash: hashCode(this.props.markup), error: null });
      });
    }

    if (this.props.injectThemeCSS) {
      this._themeNode = this.createStyleNode(getTheme(this.props.theme).styles);
    }
    if (this.props.injectLayoutCSS) {
      this._layoutNode = this.createStyleNode(
        getLayout(this.props.layout).styles
      );
    }
  }

  componentDidCatch(error, info) {
    this.props.onError && this.props.onError(error);
    this.setState({ error: error.message });
  }

  componentWillReceiveProps(newProps) {
    if (newProps.ast) {
      return;
    }

    const hash = hashCode(newProps.markup);
    if (hash !== this.state.hash) {
      this.setState({ previousAST: this.state.ast });
      compile(newProps.markup, newProps.compilerOptions)
        .then(ast => {
          this.setState({ previousAST: ast, ast, hash, error: null });
        })
        .catch(this.componentDidCatch.bind(this));
    }

    if (newProps.theme !== this.props.theme && newProps.injectThemeCSS) {
      if (this._themeNode) {
        this._themeNode.innerHTML = getTheme(newProps.theme);
      } else {
        this._themeNode = this.createStyleNode(getTheme(newProps.theme).styles);
      }
    }
    if (newProps.layout !== this.props.layout && newProps.injectLayoutCSS) {
      if (this._layoutNode) {
        this._layoutNode.innerHTML = getLayout(newProps.layout);
      } else {
        this._layoutNode = this.createStyleNode(
          getLayout(newProps.layout).styles
        );
      }
    }
  }

  getErrorComponent() {
    if (!this.state.error) {
      return null;
    }
    return React.createElement(
      this.props.errorComponent || 'pre',
      {
        className: 'idyll-document-error'
      },
      this.state.error
    );
  }

  render() {
    return (
      <div>
        <Runtime
          {...this.props}
          key={this.state.hash}
          context={context => {
            this.idyllContext = context;
            typeof this.props.context === 'function' &&
              this.props.context(context);
          }}
          initialState={
            this.props.initialState ||
            (this.idyllContext ? this.idyllContext.data() : {})
          }
          ast={this.props.ast || this.state.ast}
          userViewComponent={this.props.userViewComponent}
        />
        {this.getErrorComponent()}
      </div>
    );
  }
}

export default IdyllDocument;
