import { installTransport } from './shell.js';
import { installXhrWarning } from './xhr-warning.js';
import { transformRequest } from './transform.js';
import { installPanel } from './panel.js';

// transform-seam: the request pipeline is the shell's only protocol consumer → docs/modules/janitor-transport.md#transform-seam
installTransport(transformRequest);
installXhrWarning();
// panel-host: the script's only DOM surface, human-facing only → docs/modules/janitor-panel.md#what-it-is
installPanel();
