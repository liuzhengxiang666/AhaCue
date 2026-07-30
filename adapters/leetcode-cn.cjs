"use strict";

const STATE_KEY = "__algoCompanionPageAdapterStateV1";

function supports(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return (
      (url.hostname === "leetcode.cn" || url.hostname.endsWith(".leetcode.cn")) &&
      /^\/problems\/[^/]+/i.test(url.pathname)
    );
  } catch {
    return false;
  }
}

const installSource = `(() => {
  const key = ${JSON.stringify(STATE_KEY)};
  if (window[key]?.version === 1) return true;

  const visible = (element) => {
    if (!(element instanceof HTMLElement)) return false;
    const style = getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden";
  };
  const clean = (value, limit = 60000) =>
    String(value || "").replace(/\\u00a0/g, " ").replace(/[ \\t]+\\n/g, "\\n").trim().slice(0, limit);
  const firstText = (selectors) => {
    for (const selector of selectors) {
      for (const element of document.querySelectorAll(selector)) {
        const text = clean(element.innerText || element.textContent, 500);
        if (visible(element) && text) return text;
      }
    }
    return "";
  };
  const title = () => firstText([
    "[data-cy='question-title']",
    "[data-e2e-locator='problem-title']",
    "div[class*='title'] a[href*='/problems/']",
    "h1"
  ]);
  const statement = () => {
    const selectors = [
      "[data-track-load='description_content']",
      "[data-cy='question-content']",
      "[data-cy='description-content']",
      "[data-key='description-content']",
      "div[class*='description']",
      "div[class*='question-content']"
    ];
    const values = [];
    for (const selector of selectors) {
      for (const element of document.querySelectorAll(selector)) {
        if (!visible(element)) continue;
        const text = clean(element.innerText || element.textContent);
        if (text.length >= 40) values.push(text);
      }
    }
    values.sort((a, b) => b.length - a.length);
    return values[0] || "";
  };
  const language = () => {
    const modelLanguage = String(
      window.monaco?.editor?.getModels?.()[0]?.getLanguageId?.() || ""
    ).toLowerCase();
    if (/typescript|javascript/.test(modelLanguage)) return "javascript";
    if (/python/.test(modelLanguage)) return "python";
    if (/java/.test(modelLanguage) && !/javascript/.test(modelLanguage)) return "java";
    if (/cpp|c\\+\\+|cxx/.test(modelLanguage)) return "cpp";
    const labels = [];
    const selectors = [
      "[data-cy='lang-select']",
      "[data-e2e-locator='lang-select']",
      "button[id*='headlessui-listbox-button']",
      "button[class*='lang']",
      "[class*='language'] button"
    ];
    for (const selector of selectors) {
      for (const element of document.querySelectorAll(selector)) {
        if (visible(element)) labels.push(clean(element.innerText || element.textContent, 100).toLowerCase());
      }
    }
    for (const element of document.querySelectorAll("button, [role='button']")) {
      if (!visible(element)) continue;
      const label = clean(element.innerText || element.textContent, 100);
      if (/^(c\\+\\+|java|python3?|javascript|typescript)(\\s|$)/i.test(label)) {
        labels.push(label.toLowerCase());
      }
    }
    const value = labels.join(" ");
    if (/typescript|javascript|node\\.js/.test(value)) return "javascript";
    if (/python/.test(value)) return "python";
    if (/java/.test(value) && !/javascript/.test(value)) return "java";
    if (/c\\+\\+|cpp/.test(value)) return "cpp";
    return "cpp";
  };
  const model = () => {
    try {
      const models = window.monaco?.editor?.getModels?.() || [];
      return models.find((candidate) => typeof candidate.getValue === "function") || null;
    } catch {
      return null;
    }
  };
  const code = () => {
    const activeModel = model();
    if (activeModel) return clean(activeModel.getValue(), 60000);
    const textareas = [...document.querySelectorAll("textarea")]
      .filter(visible)
      .map((element) => clean(element.value, 60000))
      .filter(Boolean)
      .sort((a, b) => b.length - a.length);
    if (textareas[0]) return textareas[0];
    const content = document.querySelector(".cm-content, .view-lines");
    return clean(content?.innerText || content?.textContent, 60000);
  };
  const resultText = () => {
    const selectors = [
      "[data-e2e-locator='console-result']",
      "[data-e2e-locator*='result']",
      "[data-cy='result-container']",
      "[data-cy*='result']",
      "div[class*='result']",
      "div[class*='console']"
    ];
    const values = [];
    for (const selector of selectors) {
      for (const element of document.querySelectorAll(selector)) {
        if (!visible(element)) continue;
        const text = clean(element.innerText || element.textContent, 20000);
        if (text.length >= 3) values.push(text);
      }
    }
    const scored = values.map((text) => ({
      text,
      score: (/Accepted|Wrong Answer|Runtime Error|Compile Error|Time Limit|Memory Limit|通过|解答错误|执行出错|编译|超出.*限制/i.test(text) ? 100000 : 0) + text.length
    }));
    scored.sort((a, b) => b.score - a.score);
    return scored[0]?.text || "";
  };
  const status = (text) => {
    if (/Accepted|解答成功|执行通过|通过所有测试/i.test(text)) return "accepted";
    if (/Wrong Answer|解答错误|答案错误/i.test(text)) return "wrong_answer";
    if (/Compile Error|编译出错|编译错误|编译失败/i.test(text)) return "compile_error";
    if (/Runtime Error|执行出错|运行时错误|执行错误/i.test(text)) return "runtime_error";
    if (/Time Limit|超出时间限制|超时/i.test(text)) return "time_limit";
    if (/Memory Limit|超出内存限制/i.test(text)) return "memory_limit";
    return "other";
  };
  const draft = (latestResult = "") => ({
    sourceUrl: location.href,
    title: title(),
    statement: statement(),
    language: language(),
    code: code(),
    latestResult: clean(latestResult, 20000)
  });

  const state = {
    version: 1,
    sequence: 0,
    lastAttempt: null,
    readDraft: draft,
    getModel: model,
    readCode: code
  };
  window[key] = state;

  const beginAttempt = (trigger) => {
    const sequence = ++state.sequence;
    const before = resultText();
    const captured = draft("");
    const probe = (finalProbe) => {
      const output = resultText();
      const resolved = status(output);
      if (!output || (output === before && !finalProbe)) return;
      if (resolved === "other" && !finalProbe) return;
      state.lastAttempt = {
        sequence,
        trigger,
        status: resolved,
        draft: { ...captured, code: code() || captured.code, latestResult: output }
      };
    };
    [700, 1400, 2600, 5000].forEach((delay) => setTimeout(() => probe(false), delay));
    setTimeout(() => probe(true), 9000);
  };

  document.addEventListener("click", (event) => {
    const button = event.target instanceof Element ? event.target.closest("button") : null;
    if (!button) return;
    const label = clean(button.innerText || button.textContent, 80).toLowerCase();
    if (/提交|submit/.test(label)) beginAttempt("submit");
    else if (/运行|执行代码|run/.test(label)) beginAttempt("run");
  }, true);
  return true;
})()`;

async function install(contents) {
  if (!supports(contents.getURL())) return;
  await contents.executeJavaScript(installSource, true);
}

async function readContext(contents) {
  if (!supports(contents.getURL())) {
    return { recognized: false, reason: "不是力扣中国站普通题目页面。" };
  }
  await install(contents);
  return contents.executeJavaScript(`(() => {
    const state = window[${JSON.stringify(STATE_KEY)}];
    const draft = state?.readDraft?.("");
    if (!draft?.title || !draft?.statement) {
      return { recognized: false, reason: "题面仍在加载，或页面结构已经变化。" };
    }
    return { recognized: true, draft };
  })()`);
}

async function readAttempt(contents) {
  if (!supports(contents.getURL())) return null;
  await install(contents);
  return contents.executeJavaScript(
    `window[${JSON.stringify(STATE_KEY)}]?.lastAttempt || null`
  );
}

function writeSource(value, insert) {
  return `(() => {
    const state = window[${JSON.stringify(STATE_KEY)}];
    const text = ${JSON.stringify(value)};
    const activeModel = state?.getModel?.();
    try {
      if (activeModel) {
        if (${insert ? "true" : "false"}) {
          const editors = window.monaco?.editor?.getEditors?.() || [];
          const editor = editors[0];
          const position = editor?.getPosition?.();
          if (editor && position) {
            editor.executeEdits("algo-companion", [{
              range: new window.monaco.Range(position.lineNumber, position.column, position.lineNumber, position.column),
              text,
              forceMoveMarkers: true
            }]);
          } else {
            const current = activeModel.getValue();
            activeModel.setValue(current + (current.endsWith("\\n") ? "" : "\\n") + text);
          }
        } else {
          activeModel.setValue(text);
        }
        return { ok: true, message: ${insert ? '"片段已插入编辑器。"' : '"参考代码已写入编辑器。"'}, code: state.readCode() };
      }
      const textarea = [...document.querySelectorAll("textarea")]
        .find((element) => element.offsetParent !== null);
      if (textarea) {
        const next = ${insert ? 'textarea.value + (textarea.value.endsWith("\\n") ? "" : "\\n") + text' : "text"};
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
        setter?.call(textarea, next);
        textarea.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
        textarea.dispatchEvent(new Event("change", { bubbles: true }));
        return { ok: true, message: "编辑器已更新。", code: next };
      }
      return { ok: false, message: "没有找到可写入的代码编辑器。", code: state?.readCode?.() || "" };
    } catch (error) {
      return { ok: false, message: String(error?.message || error), code: state?.readCode?.() || "" };
    }
  })()`;
}

async function insertSnippet(contents, snippet) {
  await install(contents);
  return contents.executeJavaScript(writeSource(snippet, true), true);
}

async function replaceCode(contents, code) {
  await install(contents);
  return contents.executeJavaScript(writeSource(code, false), true);
}

module.exports = {
  id: "leetcode-cn-visible-page-v1",
  mode: "automatic",
  supports,
  install,
  readContext,
  readAttempt,
  insertSnippet,
  replaceCode
};

