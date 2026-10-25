import type { Rule } from '@angular-devkit/schematics';

import { ignoreDevLogs } from '../../utility/dev-logs-gitignore';

/**
 * Adds `.dev-logs`, where `ng serve` writes `LynxLogger`'s output, to the
 * workspace's `.gitignore`. `ng add` now adds it to new apps; apps made before
 * left it to the app, as the debugging guide said.
 */
export default (): Rule => ignoreDevLogs();
