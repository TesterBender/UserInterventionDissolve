import { installTransport } from './shell.js';
import { installXhrWarning } from './xhr-warning.js';
import { transformRequest } from './transform.js';

// transform-seam: the request pipeline is the shell's only protocol consumer → docs/modules/janitor-transport.md#transform-seam
installTransport(transformRequest);
installXhrWarning();
