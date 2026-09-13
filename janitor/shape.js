function isObject(value) {
  return typeof value === 'object' && value !== null;
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

// chat-shape-test: role + own content only, so Anthropic reads as chat → docs/modules/janitor-transport.md#chat-shape-adapter
export function isCompletionMessageArray(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return false;
  return messages.every((message) => {
    if (!isObject(message) || typeof message.role !== 'string') return false;
    return hasOwn(message, 'content');
  });
}

// alpha-shape-test: the four fields that mark Janitor's pre-assembly envelope → docs/modules/janitor-transport.md#chat-shape-adapter
export function isJanitorAlphaRequestShape(node) {
  return Boolean(
    isObject(node)
      && isObject(node.userConfig)
      && isObject(node.chat)
      && Array.isArray(node.chatMessages)
      && typeof node.generateType === 'string',
  );
}

function modelNameFromContainer(container) {
  if (!isObject(container)) return '';
  if (typeof container.model === 'string') return container.model;
  if (typeof container.openAiModel === 'string') return container.openAiModel;
  if (Array.isArray(container.models)) {
    const first = container.models.find((model) => typeof model === 'string');
    if (first) return first;
  }
  return '';
}

// locate-request: envelope first, then the model-sibling walk; no responses shape → docs/modules/janitor-transport.md#chat-shape-adapter
export function locateCompletionRequest(root) {
  if (!isObject(root)) return null;
  if (isJanitorAlphaRequestShape(root)) {
    return { kind: 'janitor-alpha', requestContainer: root.userConfig, janitorRoot: root };
  }
  const seen = new WeakSet();
  const stack = [{ node: root, parent: null }];
  let best = null;
  let bestScore = 0;
  while (stack.length) {
    const frame = stack.pop();
    const node = frame.node;
    if (!isObject(node) || seen.has(node)) continue;
    seen.add(node);
    const chatShape = isCompletionMessageArray(node.messages);
    if (chatShape) {
      let container = null;
      let score = 0;
      if (modelNameFromContainer(node)) {
        container = node;
        score = 2;
      } else {
        for (let ancestor = frame.parent; ancestor; ancestor = ancestor.parent) {
          if (modelNameFromContainer(ancestor.node)) {
            container = ancestor.node;
            score = 1;
            break;
          }
        }
      }
      if (container && score > bestScore) {
        best = {
          kind: 'chat',
          messagesContainer: node,
          requestContainer: container,
          modelName: modelNameFromContainer(container),
        };
        bestScore = score;
        if (score === 2) return best;
      }
    }
    for (const key of Object.keys(node)) {
      if (key === 'messages' && chatShape) continue;
      const child = node[key];
      if (isObject(child)) stack.push({ node: child, parent: frame });
    }
  }
  return best;
}
