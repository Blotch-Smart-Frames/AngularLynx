import commentDecoratorOrder from './rules/comment-decorator-order.mjs';
import consistentPackageVersions from './rules/consistent-package-versions.mjs';
import multilineCommentStyle from './rules/multiline-comment-style.mjs';
import noFunctionDeclaration from './rules/no-function-declaration.mjs';
import noLegacyDecorators from './rules/no-legacy-decorators.mjs';
import noPrivateKeyword from './rules/no-private-keyword.mjs';

export default {
  meta: { name: '@blotch/oxlint-plugin' },
  rules: {
    'comment-decorator-order': commentDecoratorOrder,
    'consistent-package-versions': consistentPackageVersions,
    'multiline-comment-style': multilineCommentStyle,
    'no-function-declaration': noFunctionDeclaration,
    'no-legacy-decorators': noLegacyDecorators,
    'no-private-keyword': noPrivateKeyword,
  },
};
