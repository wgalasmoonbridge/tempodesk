// Minimal Chrome DevTools Protocol driver for the TempoDesk WebView2 page.
// Requires the app to be launched with:
//   WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222
const PORT = process.env.CDP_PORT ?? "9222";

export async function connect() {
  let targets = [];
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/json`);
      targets = await response.json();
      if (targets.some((target) => target.type === "page")) break;
    } catch {
      /* app not ready */
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const page = targets.find((target) => target.type === "page");
  if (!page) throw new Error("No WebView2 page target found on port " + PORT);

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  const pending = new Map();
  let nextId = 1;
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
    }
  });
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });

  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    if (result.exceptionDetails) {
      const details = result.exceptionDetails;
      throw new Error(
        details.exception?.description ??
          details.text ??
          "Evaluation failed in the page",
      );
    }
    return result.result?.value;
  };

  const waitFor = async (expression, { timeout = 8000, label = expression } = {}) => {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      if (await evaluate(`Boolean(${expression})`)) return true;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    throw new Error(`Timed out waiting for ${label}`);
  };

  const click = async (text, scope = "document") => {
    const clicked = await evaluate(`(() => {
      const root = ${scope};
      if (!root) return false;
      const buttons = [...root.querySelectorAll('button')];
      const target = buttons.find((button) => button.textContent.trim() === ${JSON.stringify(text)});
      if (!target) return false;
      target.click();
      return true;
    })()`);
    if (!clicked) throw new Error(`Button not found: ${text}`);
    await new Promise((resolve) => setTimeout(resolve, 200));
  };

  const clickAria = async (label, scope = "document") => {
    const clicked = await evaluate(`(() => {
      const root = ${scope};
      const target = root?.querySelector('[aria-label=${JSON.stringify(label)}]');
      if (!target) return false;
      target.click();
      return true;
    })()`);
    if (!clicked) throw new Error(`aria-label not found: ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 200));
  };

  const type = async (selector, value, scope = "document") => {
    const ok = await evaluate(`(() => {
      const root = ${scope};
      const el = root?.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      setter.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    if (!ok) throw new Error(`Input not found: ${selector}`);
    await new Promise((resolve) => setTimeout(resolve, 150));
  };

  const typeAt = async (selector, index, value, scope = "document") => {
    const ok = await evaluate(`(() => {
      const root = ${scope};
      const el = root?.querySelectorAll(${JSON.stringify(selector)})[${index}];
      if (!el) return false;
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      setter.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    if (!ok) throw new Error(`Input not found: ${selector}[${index}]`);
    await new Promise((resolve) => setTimeout(resolve, 150));
  };

  const select = async (selector, value, scope = "document") => {
    const ok = await evaluate(`(() => {
      const root = ${scope};
      const el = root?.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
      setter.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    if (!ok) throw new Error(`Select not found: ${selector}`);
    await new Promise((resolve) => setTimeout(resolve, 200));
  };

  const screenshot = async (path) => {
    await send("Page.bringToFront");
    const result = await send("Page.captureScreenshot", { format: "png" });
    const { writeFileSync } = await import("node:fs");
    writeFileSync(path, Buffer.from(result.data, "base64"));
  };

  const text = () => evaluate("document.body.innerText");

  const webSocket = ws;
  return { send, evaluate, waitFor, click, clickAria, type, typeAt, select, screenshot, text, close: () => webSocket.close() };
}

export function assert(condition, message) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}
