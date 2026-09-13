import { installTransport } from './shell.js';
import { installXhrWarning } from './xhr-warning.js';

// no-op-transform: the phase boundary; protocol logic replaces this → docs/modules/janitor-transport.md#transform-seam
installTransport(() => false);
installXhrWarning();
