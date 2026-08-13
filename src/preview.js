// Reddit to AI - Prompt Preview page
let previewState = {
  data: null,
  settings: {},
  template: '',
  renderedData: null,
  dirty: false,
  generatedPrompt: '',
  pendingGeneratedPrompt: '',
  pendingRenderedData: null,
  pendingBuildOptions: null,
  sendInFlight: false,
  hasCustomPruning: false,
  apiStatus: null,
  apiInFlight: false,
  apiTimer: null,
  historyId: null
};

const els = {};

document.addEventListener('DOMContentLoaded', async () => {
  if (typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.connect === 'function') {
    chrome.runtime.connect({ name: 'keep-alive' });
  }
  if (typeof initI18n === 'function') {
    await initI18n();
    localizeHtmlPage();
  }

  bindElements();
  bindEvents();
  loadPreviewData();
  loadDirectApiStatus();

  // The preview page is where exact token counts matter, so it triggers the lazy
  // tokenizer load and refreshes the displayed count once the rank table is ready.
  if (typeof globalThis.R2ATiktokenEnsure === 'function') {
    globalThis.R2ATiktokenEnsure().then(() => {
      if (els.promptTextarea && (previewState.renderedData || previewState.data)) {
        updateBudget(els.promptTextarea.value, previewState.renderedData || previewState.data);
      }
    });
  }
});

function bindElements() {
  els.threadMeta = document.getElementById('threadMeta');
  els.warningLabel = document.getElementById('warningLabel');
  els.warningMessage = document.getElementById('warningMessage');
  els.charCount = document.getElementById('charCount');
  els.tokenCount = document.getElementById('tokenCount');
  els.commentCount = document.getElementById('commentCount');
  els.imageCount = document.getElementById('imageCount');
  els.meterFill = document.getElementById('meterFill');
  els.budgetCard = document.getElementById('budgetCard');
  els.contextPresetSelect = document.getElementById('contextPresetSelect');
  els.trimStrategySelect = document.getElementById('trimStrategySelect');
  els.mediaModeSelect = document.getElementById('mediaModeSelect');
  els.providerSelect = document.getElementById('providerSelect');
  els.outputFormatSelect = document.getElementById('outputFormatSelect');
  els.promptTextarea = document.getElementById('promptTextarea');
  els.copyBtn = document.getElementById('copyBtn');
  els.copyBtnBottom = document.getElementById('copyBtnBottom');
  els.exportChips = document.querySelectorAll('.export-chip');
  els.savePresetBtn = document.getElementById('savePresetBtn');
  els.sendBtn = document.getElementById('sendBtn');
  els.sendBtnBottom = document.getElementById('sendBtnBottom');
  els.skipNextBtn = document.getElementById('skipNextBtn');
  els.resumeBtn = document.getElementById('resumeBtn');
  els.missingCommentsCard = document.getElementById('missingCommentsCard');
  els.missingCommentsText = document.getElementById('missingCommentsText');
  els.statusText = document.getElementById('statusText');
  els.backBtn = document.getElementById('backBtn');
  els.backBtnTop = document.getElementById('backBtnTop');
  els.skipPreviewToggle = document.getElementById('skipPreviewToggle');
  els.settingsSummary = document.getElementById('settingsSummary');
  els.restorePromptBtn = document.getElementById('restorePromptBtn');
  els.rebuildNotice = document.getElementById('rebuildNotice');
  els.applyRebuiltPromptBtn = document.getElementById('applyRebuiltPromptBtn');
  els.keepEditsBtn = document.getElementById('keepEditsBtn');
  els.apiProviderSelect = document.getElementById('apiProviderSelect');
  els.sendApiBtn = document.getElementById('sendApiBtn');
  els.apiNotConfigured = document.getElementById('apiNotConfigured');
  els.apiNotConfiguredText = document.getElementById('apiNotConfiguredText');
  els.apiOpenOptionsBtn = document.getElementById('apiOpenOptionsBtn');
  els.apiLoading = document.getElementById('apiLoading');
  els.apiElapsed = document.getElementById('apiElapsed');
  els.apiError = document.getElementById('apiError');
  els.apiErrorMessage = document.getElementById('apiErrorMessage');
  els.apiRetryBtn = document.getElementById('apiRetryBtn');
  els.apiResult = document.getElementById('apiResult');
  els.apiResultMeta = document.getElementById('apiResultMeta');
  els.apiResponseText = document.getElementById('apiResponseText');
  els.apiCopyBtn = document.getElementById('apiCopyBtn');
  els.commentsTreeContainer = document.getElementById('commentsTreeContainer');
  els.selectAllCommentsBtn = document.getElementById('selectAllCommentsBtn');
  els.clearAllCommentsBtn = document.getElementById('clearAllCommentsBtn');
}

function bindEvents() {
  [els.contextPresetSelect, els.trimStrategySelect, els.mediaModeSelect, els.outputFormatSelect].forEach(select => {
    select?.addEventListener('change', () => {
      previewState.dirty = false;
      previewState.hasCustomPruning = false; // Reset on preset/strategy change
      chrome.storage.sync.set({
        contextPreset: els.contextPresetSelect.value,
        trimStrategy: els.trimStrategySelect.value,
        mediaMode: els.mediaModeSelect.value,
        outputFormat: els.outputFormatSelect.value
      });
      rebuildPrompt();
    });
  });

  els.providerSelect?.addEventListener('change', () => {
    chrome.storage.sync.set({ selectedLlmProvider: els.providerSelect.value });
    updateBudget(els.promptTextarea.value, previewState.renderedData || previewState.data);
    updateSettingsSummary();
  });

  els.promptTextarea?.addEventListener('input', () => {
    previewState.dirty = true;
    if (els.restorePromptBtn) els.restorePromptBtn.disabled = els.promptTextarea.value === previewState.generatedPrompt;
    updateBudget(els.promptTextarea.value, previewState.renderedData || previewState.data);
  });

  els.copyBtn?.addEventListener('click', copyPrompt);
  els.copyBtnBottom?.addEventListener('click', copyPrompt);
  els.exportChips.forEach(chip => {
    chip.addEventListener('click', () => {
      const format = chip.getAttribute('data-format');
      exportPrompt(format);
    });
  });
  els.savePresetBtn?.addEventListener('click', saveCurrentPreset);
  els.sendBtn?.addEventListener('click', sendPrompt);
  els.sendBtnBottom?.addEventListener('click', sendPrompt);
  els.skipNextBtn?.addEventListener('click', sendAndSkipPreviewNextTime);
  els.resumeBtn?.addEventListener('click', resumeMissingComments);
  els.backBtn?.addEventListener('click', focusRedditTab);
  els.backBtnTop?.addEventListener('click', focusRedditTab);
  els.restorePromptBtn?.addEventListener('click', restoreGeneratedPrompt);
  els.applyRebuiltPromptBtn?.addEventListener('click', applyRebuiltPrompt);
  els.keepEditsBtn?.addEventListener('click', keepEditedPrompt);
  els.skipPreviewToggle?.addEventListener('change', () => {
    chrome.storage.sync.set({ showPromptPreview: !els.skipPreviewToggle.checked });
    setStatus(els.skipPreviewToggle.checked ? 'Future scrapes will send directly.' : 'Future scrapes will open preview first.');
  });

  els.selectAllCommentsBtn?.addEventListener('click', () => {
    toggleAllCheckboxes(true);
  });
  els.clearAllCommentsBtn?.addEventListener('click', () => {
    toggleAllCheckboxes(false);
  });
  els.commentsTreeContainer?.addEventListener('change', handleCheckboxChange);

  els.apiProviderSelect?.addEventListener('change', () => {
    chrome.storage.local.set({ lastDirectApiProvider: els.apiProviderSelect.value });
    updateApiAvailability();
  });
  els.sendApiBtn?.addEventListener('click', sendPromptViaApi);
  els.apiRetryBtn?.addEventListener('click', sendPromptViaApi);
  els.apiCopyBtn?.addEventListener('click', copyApiResponse);
  els.apiOpenOptionsBtn?.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
}

function setStatus(message) {
  if (els.statusText) els.statusText.textContent = message;
}

function loadPreviewData() {
  setStatus('Loading scraped thread…');
  chrome.runtime.sendMessage({ action: 'getPreviewData' }, (response) => {
    if (chrome.runtime.lastError || response?.error || !response?.data) {
      const error = response?.error || chrome.runtime.lastError?.message || 'No preview data found.';
      setStatus(error);
      if (els.promptTextarea) els.promptTextarea.value = `Could not load preview data.\n\n${error}`;
      return;
    }

    previewState.data = response.data;
    previewState.settings = response.settings || {};
    previewState.historyId = response.historyId || null;
    previewState.template = previewState.settings.defaultPromptTemplate || 'Please analyze the following Reddit thread.\n\n{content}';

    els.contextPresetSelect.value = previewState.settings.contextPreset || 'balanced';
    els.trimStrategySelect.value = previewState.settings.trimStrategy || response.data.filtersApplied?.trimStrategy || 'top';
    els.mediaModeSelect.value = previewState.settings.mediaMode || 'attach';
    els.providerSelect.value = previewState.settings.selectedLlmProvider || 'gemini';
    els.outputFormatSelect.value = previewState.settings.outputFormat || 'auto';
    if (els.skipPreviewToggle) els.skipPreviewToggle.checked = previewState.settings.showPromptPreview === false;

    updateThreadMeta();
    rebuildPrompt();
    let allComments = [];
    if (previewState.data.threads) {
      previewState.data.threads.forEach(t => {
        allComments = allComments.concat(t.comments || []);
      });
    } else {
      allComments = previewState.data.comments || [];
    }
    renderCommentTree(allComments);
    updateMissingCommentsNotice();
    updateSettingsSummary();
    setStatus('Ready. Review or edit the prompt before sending.');
  });
}

function updateThreadMeta() {
  if (!els.threadMeta || !previewState.data) return;
  if (Array.isArray(previewState.data.threads)) {
    els.threadMeta.textContent = `${previewState.data.threads.length} Reddit threads combined for comparison.`;
    return;
  }
  const post = previewState.data.post || {};
  const title = post.title || 'Untitled thread';
  const subreddit = post.subreddit ? `r/${post.subreddit}` : 'unknown subreddit';
  els.threadMeta.textContent = `${title} · ${subreddit}`;
}

function getCurrentBuildOptions() {
  return {
    contextPreset: els.contextPresetSelect?.value || 'balanced',
    trimStrategy: els.trimStrategySelect?.value || 'top',
    mediaMode: els.mediaModeSelect?.value || 'attach'
    ,
    outputFormat: els.outputFormatSelect?.value || 'auto'
  };
}

function buildPromptForOptions(options) {
  if (!previewState.data || !window.R2AIPrompt) return;
  let renderedData;
  if (previewState.hasCustomPruning) {
    renderedData = JSON.parse(JSON.stringify(previewState.data));
    const selectedIds = new Set(getSelectedCommentIds());
    if (renderedData.threads) {
      renderedData.threads = renderedData.threads.map(thread => ({
        ...thread,
        comments: R2AIPrompt.rebuildTreeFromSelected(thread.comments, selectedIds)
      }));
    } else {
      renderedData.comments = R2AIPrompt.rebuildTreeFromSelected(renderedData.comments, selectedIds);
    }
  } else {
    renderedData = R2AIPrompt.applyContextPreset(previewState.data, options.contextPreset, options);
  }
  const prompt = R2AIPrompt.buildPromptText(renderedData, previewState.template, {
    ...options,
    contextPreset: null,
    skipContextPreset: true
  });
  return { renderedData, prompt, options };
}

function setPendingRebuild(result) {
  previewState.pendingGeneratedPrompt = result?.prompt || '';
  previewState.pendingRenderedData = result?.renderedData || null;
  previewState.pendingBuildOptions = result?.options || null;
  setRebuildControlsVisible(Boolean(result));
}

function setRebuildControlsVisible(visible) {
  if (els.rebuildNotice) els.rebuildNotice.hidden = !visible;
  if (els.applyRebuiltPromptBtn) els.applyRebuiltPromptBtn.hidden = !visible;
  if (els.keepEditsBtn) els.keepEditsBtn.hidden = !visible;
}

function rebuildPrompt() {
  const result = buildPromptForOptions(getCurrentBuildOptions());
  if (!result) return;
  if (previewState.dirty) {
    setPendingRebuild(result);
    setStatus('Settings changed. Your edited prompt was kept.');
    updateSettingsSummary();
    return;
  }
  applyGeneratedPrompt(result);
}

function applyGeneratedPrompt(result) {
  previewState.renderedData = result.renderedData;
  const prompt = result.prompt;
  previewState.generatedPrompt = prompt;
  if (els.promptTextarea) els.promptTextarea.value = prompt;
  previewState.dirty = false;
  setPendingRebuild(null);
  if (els.restorePromptBtn) els.restorePromptBtn.disabled = true;
  updateBudget(prompt, previewState.renderedData);
  updateSettingsSummary();

  if (!previewState.hasCustomPruning) {
    let allComments = [];
    if (result.renderedData.threads) {
      result.renderedData.threads.forEach(t => {
        allComments = allComments.concat(t.comments || []);
      });
    } else {
      allComments = result.renderedData.comments || [];
    }
    renderCommentTree(allComments);
  }
}

function applyRebuiltPrompt() {
  if (!previewState.pendingGeneratedPrompt || !previewState.pendingRenderedData) return;
  applyGeneratedPrompt({
    prompt: previewState.pendingGeneratedPrompt,
    renderedData: previewState.pendingRenderedData,
    options: previewState.pendingBuildOptions || getCurrentBuildOptions()
  });
  setStatus('Rebuilt prompt applied.');
}

function keepEditedPrompt() {
  setPendingRebuild(null);
  setStatus('Edited prompt kept.');
}

function updateBudget(promptText, dataForStats) {
  if (!window.R2AIPrompt) return;
  const stats = R2AIPrompt.estimatePromptStats(promptText, dataForStats);
  els.charCount.textContent = formatNumber(stats.chars);
  els.tokenCount.textContent = formatNumber(stats.tokens);
  els.commentCount.textContent = formatNumber(stats.comments);
  els.imageCount.textContent = formatNumber(stats.images);
  els.warningLabel.textContent = `${stats.warning.label} warning`;
  els.warningMessage.textContent = getProviderGuidance(stats, els.providerSelect?.value || 'gemini');
  els.meterFill.style.width = `${stats.percentOfLargeContext}%`;
  els.budgetCard.classList.remove('low', 'medium', 'high', 'critical');
  els.budgetCard.classList.add(stats.warning.key);
}

function getProviderGuidance(stats, provider) {
  const names = { gemini: 'Gemini', chatgpt: 'ChatGPT', claude: 'Claude', aistudio: 'AI Studio', deepseek: 'DeepSeek', groq: 'Groq', custom: 'Custom' };
  const providerName = names[provider] || 'this AI platform';
  if (stats.warning.key === 'critical') return `${providerName} may reject or truncate this. Use Balanced or Small before sending.`;
  if (stats.warning.key === 'high') return `${providerName} should handle this only on large-context models. Consider trimming comments.`;
  if (stats.warning.key === 'medium') return `${providerName} should usually accept this, but smaller models may shorten the answer.`;
  return `${providerName} should have comfortable room for this prompt.`;
}

function updateSettingsSummary() {
  if (!els.settingsSummary) return;
  const metadata = previewState.data?.metadata || {};
  const filters = previewState.data?.filtersApplied || {};
  const labels = [
    `Preset: ${metadata.preset || previewState.settings.selectedPreset || 'summarize'}`,
    `AI: ${els.providerSelect?.selectedOptions?.[0]?.textContent || 'Gemini'}`,
    `Budget: ${els.contextPresetSelect?.value || metadata.contextPreset || 'balanced'}`,
    `Trim: ${els.trimStrategySelect?.value || filters.trimStrategy || 'top'}`,
    `Sort: ${metadata.redditSortMode || filters.redditSortMode || 'confidence'}`,
    `Depth: ${metadata.scrapeDepth || previewState.data?.maxDepth || 'unknown'}`,
    `Comments: ${metadata.finalCommentCount || metadata.commentCount || R2AIPrompt.countDataComments(previewState.renderedData || previewState.data)}`,
    `Format: ${els.outputFormatSelect?.value || 'auto'}`
  ];
  els.settingsSummary.innerHTML = '';
  labels.forEach(label => {
    const pill = document.createElement('span');
    pill.className = 'summary-pill';
    pill.textContent = label;
    els.settingsSummary.appendChild(pill);
  });
}

function restoreGeneratedPrompt() {
  if (!els.promptTextarea) return;
  els.promptTextarea.value = previewState.generatedPrompt || '';
  previewState.dirty = false;
  setPendingRebuild(null);
  if (els.restorePromptBtn) els.restorePromptBtn.disabled = true;
  updateBudget(els.promptTextarea.value, previewState.renderedData || previewState.data);
  setStatus('Generated prompt restored.');
}

function updateMissingCommentsNotice() {
  const failed = previewState.data?.metadata?.failedMoreIds || [];
  if (!els.missingCommentsCard) return;
  els.missingCommentsCard.hidden = failed.length === 0;
  if (failed.length > 0 && els.missingCommentsText) {
    els.missingCommentsText.textContent = `${failed.length} omitted comment IDs failed during morechildren loading.`;
  }
}

async function copyPrompt() {
  const text = els.promptTextarea.value;
  try {
    await navigator.clipboard.writeText(text);
    setStatus('Prompt copied to clipboard.');
  } catch (error) {
    els.promptTextarea.select();
    document.execCommand('copy');
    setStatus(`Prompt copied with fallback. ${error.message || ''}`.trim());
  }
}

function exportPrompt(format) {
  if (!format) return;

  const data = previewState.renderedData || previewState.data;
  if (!data) {
    setStatus('No data available to export.');
    return;
  }

  let content = '';
  let mimeType = 'text/plain';
  let ext = 'txt';

  try {
    if (format === 'markdown') {
      content = R2AIPrompt.exportToMarkdown(data);
      mimeType = 'text/markdown;charset=utf-8;';
      ext = 'md';
    } else if (format === 'json') {
      content = R2AIPrompt.exportToJSON(data);
      mimeType = 'application/json;charset=utf-8;';
      ext = 'json';
    } else if (format === 'csv') {
      content = R2AIPrompt.exportToCSV(data);
      mimeType = 'text/csv;charset=utf-8;';
      ext = 'csv';
    } else {
      return;
    }

    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    const subreddit = (data.post?.subreddit || 'multi-thread').replace(/[\/\\?%*:|"<>\s]/g, '_');
    anchor.href = url;
    anchor.download = `reddit-to-ai-preview-${subreddit}-${Date.now()}.${ext}`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
    setStatus(`Preview exported as ${format.toUpperCase()}.`);
  } catch (err) {
    console.error('Export failed:', err);
    setStatus('Export failed.');
  }
}

function saveCurrentPreset() {
  const name = prompt('Preset name:', 'Custom preview preset');
  if (!name) return;
  const template = deriveTemplateFromCurrentPrompt();
  const savedPreset = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    createdAt: Date.now(),
    template,
    contextPreset: els.contextPresetSelect.value,
    trimStrategy: els.trimStrategySelect.value,
    mediaMode: els.mediaModeSelect.value
  };
  chrome.storage.sync.get(['savedPromptPresets'], (result) => {
    const presets = Array.isArray(result.savedPromptPresets) ? result.savedPromptPresets : [];
    presets.unshift(savedPreset);
    chrome.storage.sync.set({ savedPromptPresets: presets.slice(0, 20) }, () => {
      setStatus(`Saved preset “${name}”.`);
    });
  });
}

function deriveTemplateFromCurrentPrompt() {
  const editedText = els.promptTextarea?.value || '';
  if (editedText.includes('{content}')) return editedText;
  if (!previewState.dirty || !window.R2AIPrompt) return previewState.template;

  const options = getCurrentBuildOptions();
  const contentOnly = R2AIPrompt.buildPromptText(
    previewState.renderedData || previewState.data,
    '{content}',
    { ...options, contextPreset: null }
  );
  if (contentOnly && editedText.includes(contentOnly)) {
    return editedText.replace(contentOnly, '{content}');
  }
  return previewState.template;
}

function sendPrompt() {
  if (previewState.sendInFlight) {
    setStatus('Already opening AI tab.');
    return;
  }
  const promptText = els.promptTextarea.value.trim();
  if (!promptText) {
    setStatus('Prompt is empty.');
    return;
  }
  setSendInFlight(true);
  setStatus('Opening AI tab…');
  chrome.runtime.sendMessage({
    action: 'sendPromptToAi',
    promptText,
    aiProvider: els.providerSelect.value,
    mediaMode: els.mediaModeSelect.value,
    renderedData: previewState.renderedData || previewState.data
  }, (response) => {
    setSendInFlight(false);
    if (chrome.runtime.lastError || response?.error) {
      setStatus(response?.error || chrome.runtime.lastError?.message || 'Could not send prompt.');
      return;
    }
    setStatus('AI tab opened. If auto-paste fails, use the fallback copy button on that page.');
  });
}

// =====================
// Direct API mode
// =====================
//
// The response is rendered with textContent (never innerHTML): it is model output
// built from untrusted Reddit text, so it is treated as data, not markup. CSS
// `white-space: pre-wrap` is what preserves its line breaks and indentation.

function loadDirectApiStatus() {
  if (!els.apiProviderSelect) return;
  chrome.runtime.sendMessage({ action: 'getDirectApiStatus' }, (response) => {
    if (chrome.runtime.lastError || response?.error || !response?.providers) {
      previewState.apiStatus = null;
      updateApiAvailability();
      return;
    }
    previewState.apiStatus = response.providers;
    els.apiProviderSelect.innerHTML = '';
    Object.values(response.providers).forEach(provider => {
      const option = document.createElement('option');
      option.value = provider.id;
      // Built with textContent so a provider label can never inject markup.
      option.textContent = provider.configured ? provider.label : `${provider.label} (no key)`;
      els.apiProviderSelect.appendChild(option);
    });

    chrome.storage.local.get(['lastDirectApiProvider'], (stored) => {
      const preferred = stored?.lastDirectApiProvider;
      // Default to the first provider that actually has a key configured.
      const firstConfigured = Object.values(response.providers).find(p => p.configured);
      const chosen = (preferred && response.providers[preferred])
        ? preferred
        : (firstConfigured?.id || Object.keys(response.providers)[0]);
      if (chosen) els.apiProviderSelect.value = chosen;
      updateApiAvailability();
    });
  });
}

// A key added on the options page must take effect without reloading this tab:
// the "Add a key in options" link would otherwise lead back to a still-disabled
// button. An in-flight request is left alone so the refresh cannot re-enable
// controls mid-send.
if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.directApiConfig) return;
    if (previewState.apiInFlight) return;
    loadDirectApiStatus();
  });
}

function getSelectedApiProvider() {
  const id = els.apiProviderSelect?.value;
  if (!id || !previewState.apiStatus) return null;
  return previewState.apiStatus[id] || null;
}

function updateApiAvailability() {
  const provider = getSelectedApiProvider();
  const configured = Boolean(provider?.configured);
  if (els.sendApiBtn) els.sendApiBtn.disabled = !configured || previewState.apiInFlight;
  if (els.apiNotConfigured) els.apiNotConfigured.hidden = configured;
  if (!configured && provider && els.apiNotConfiguredText) {
    els.apiNotConfiguredText.textContent =
      t('preview_api_no_key_for', [provider.label]) || `No API key is configured for ${provider.label}.`;
  }
}

function setApiInFlight(inFlight) {
  previewState.apiInFlight = inFlight;
  if (els.sendApiBtn) els.sendApiBtn.disabled = inFlight || !getSelectedApiProvider()?.configured;
  if (els.apiRetryBtn) els.apiRetryBtn.disabled = inFlight;
  if (els.apiProviderSelect) els.apiProviderSelect.disabled = inFlight;
  if (els.apiLoading) els.apiLoading.hidden = !inFlight;

  if (previewState.apiTimer) {
    clearInterval(previewState.apiTimer);
    previewState.apiTimer = null;
  }
  if (inFlight) {
    const startedAt = Date.now();
    if (els.apiElapsed) els.apiElapsed.textContent = '0s';
    previewState.apiTimer = setInterval(() => {
      const seconds = Math.floor((Date.now() - startedAt) / 1000);
      if (els.apiElapsed) els.apiElapsed.textContent = `${seconds}s`;
    }, 1000);
  }
}

function showApiError(message, retryable) {
  if (!els.apiError) return;
  els.apiError.hidden = false;
  const suffix = retryable
    ? ` ${t('preview_api_retryable') || 'This looks temporary — try again in a moment.'}`
    : '';
  els.apiErrorMessage.textContent = `${message}${suffix}`;
}

function clearApiError() {
  if (els.apiError) els.apiError.hidden = true;
  if (els.apiErrorMessage) els.apiErrorMessage.textContent = '';
}

function sendPromptViaApi() {
  if (previewState.apiInFlight) return;
  const provider = getSelectedApiProvider();
  if (!provider?.configured) {
    updateApiAvailability();
    return;
  }
  const promptText = els.promptTextarea?.value.trim() || '';
  if (!promptText) {
    showApiError(t('preview_api_empty_prompt') || 'Prompt is empty.', false);
    return;
  }

  clearApiError();
  if (els.apiResult) els.apiResult.hidden = true;
  setApiInFlight(true);
  setStatus(t('preview_api_status_sending') || 'Sending the prompt to the API…');

  chrome.runtime.sendMessage({
    action: 'sendPromptViaApi',
    apiProvider: provider.id,
    promptText,
    historyId: previewState.historyId
  }, (response) => {
    setApiInFlight(false);
    if (chrome.runtime.lastError || response?.error || !response?.response) {
      const message = response?.error
        || chrome.runtime.lastError?.message
        || (t('preview_api_failed') || 'The API request failed.');
      // A dropped message channel (worker torn down mid-request) is worth retrying.
      const retryable = response?.retryable === true || Boolean(chrome.runtime.lastError);
      showApiError(message, retryable);
      setStatus(t('preview_api_status_failed') || 'API request failed.');
      return;
    }
    renderApiResponse(response.response);
  });
}

function renderApiResponse(result) {
  if (!els.apiResult || !els.apiResponseText) return;
  els.apiResult.hidden = false;

  if (result.refused) {
    els.apiResponseText.textContent =
      t('preview_api_refused') || 'The provider declined to answer this request.';
  } else if (!result.text) {
    els.apiResponseText.textContent =
      t('preview_api_empty_response') || 'The provider returned an empty response.';
  } else {
    // textContent, never innerHTML.
    els.apiResponseText.textContent = result.text;
  }

  const seconds = Math.round((result.durationMs || 0) / 1000);
  const parts = [result.model, `${seconds}s`];
  if (result.truncated) {
    parts.push(t('preview_api_truncated') || 'truncated at the token limit');
  }
  els.apiResultMeta.textContent = parts.filter(Boolean).join(' · ');
  setStatus(t('preview_api_status_done') || 'API response received.');
}

async function copyApiResponse() {
  const text = els.apiResponseText?.textContent || '';
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    setStatus(t('preview_api_copied') || 'API response copied to clipboard.');
  } catch (error) {
    setStatus(`Copy failed. ${error.message || ''}`.trim());
  }
}

function setSendInFlight(inFlight) {
  previewState.sendInFlight = inFlight;
  [els.sendBtn, els.sendBtnBottom, els.skipNextBtn].forEach(button => {
    if (button) button.disabled = inFlight;
  });
}

function sendAndSkipPreviewNextTime() {
  chrome.storage.sync.set({ showPromptPreview: false }, () => {
    if (els.skipPreviewToggle) els.skipPreviewToggle.checked = true;
    sendPrompt();
  });
}

function resumeMissingComments() {
  els.resumeBtn.disabled = true;
  setStatus('Trying to resume missing comments…');
  chrome.runtime.sendMessage({ action: 'resumeMissingComments' }, (response) => {
    els.resumeBtn.disabled = false;
    if (chrome.runtime.lastError || response?.error) {
      setStatus(response?.error || chrome.runtime.lastError?.message || 'Resume failed.');
      return;
    }
    if (response?.data) {
      previewState.data = response.data;
      previewState.dirty = false;
      updateThreadMeta();
      rebuildPrompt();
      updateMissingCommentsNotice();
      setStatus(`Resume complete. Added ${response.addedCount || 0} comments.`);
    }
  });
}

function focusRedditTab() {
  chrome.runtime.sendMessage({ action: 'focusLastRedditTab' }, (response) => {
    if (chrome.runtime.lastError || response?.error) {
      setStatus(response?.error || chrome.runtime.lastError?.message || 'Could not focus Reddit tab.');
    }
  });
}

function formatNumber(value) {
  return new Intl.NumberFormat().format(value || 0);
}

function escapeHtml(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function getSnippet(text) {
  const cleanText = text || '';
  if (cleanText.length <= 100) return escapeHtml(cleanText);
  return escapeHtml(cleanText.substring(0, 100)) + '...';
}

function buildCommentTreeHtml(comment, checkedIds) {
  const hasReplies = Array.isArray(comment.replies) && comment.replies.length > 0;
  const author = escapeHtml(comment.author || '[deleted]');
  const score = typeof comment.score === 'number' ? comment.score : 0;
  const isChecked = checkedIds.has(comment.id);
  const snippet = getSnippet(comment.text);
  // comment.id is scraped from the page, so it is escaped like every other
  // interpolated value even though Reddit ids are normally plain `t1_xxxxx`.
  const commentId = escapeHtml(comment.id == null ? '' : String(comment.id));

  const checkboxHtml = `<input type="checkbox" class="comment-checkbox" data-id="${commentId}" ${isChecked ? 'checked' : ''}>`;
  const metaHtml = `<span class="comment-meta"><span class="author">u/${author}</span> <span class="score">(${score} pts)</span></span>`;
  const textHtml = `<span class="comment-text-snippet">${snippet}</span>`;

  if (hasReplies) {
    const childrenHtml = comment.replies.map(reply => buildCommentTreeHtml(reply, checkedIds)).join('');
    return `
      <details open class="comment-node" data-comment-id="${commentId}">
        <summary class="comment-summary">
          ${checkboxHtml}
          ${metaHtml}
          ${textHtml}
        </summary>
        ${childrenHtml}
      </details>
    `;
  } else {
    return `
      <div class="comment-leaf" data-comment-id="${commentId}">
        ${checkboxHtml}
        ${metaHtml}
        ${textHtml}
      </div>
    `;
  }
}

function renderCommentTree(comments) {
  if (!els.commentsTreeContainer) return;
  if (!Array.isArray(comments) || comments.length === 0) {
    els.commentsTreeContainer.innerHTML = '<p style="padding: 8px; color: var(--dim);">No comments available.</p>';
    return;
  }
  const checkedIds = new Set();
  function gatherIds(list) {
    for (const comment of list || []) {
      checkedIds.add(comment.id);
      gatherIds(comment.replies);
    }
  }
  gatherIds(comments);
  
  els.commentsTreeContainer.innerHTML = comments.map(comment => buildCommentTreeHtml(comment, checkedIds)).join('');
  updateCheckboxPropagation();
}

function updateCheckboxPropagation() {
  const container = els.commentsTreeContainer;
  if (!container) return;
  const roots = container.children;
  for (const root of roots) {
    propagateNode(root, true);
  }
}

function propagateNode(element, parentCheckedAndEnabled) {
  const isLeaf = element.classList.contains('comment-leaf');
  const isNode = element.classList.contains('comment-node');
  if (!isLeaf && !isNode) return;

  let checkbox;
  if (isLeaf) {
    checkbox = element.querySelector(':scope > .comment-checkbox');
  } else {
    checkbox = element.querySelector(':scope > .comment-summary > .comment-checkbox');
  }

  if (!checkbox) return;

  if (!parentCheckedAndEnabled) {
    checkbox.disabled = true;
  } else {
    checkbox.disabled = false;
  }

  if (isNode) {
    const childCheckedAndEnabled = parentCheckedAndEnabled && checkbox.checked;
    const childNodes = element.querySelectorAll(':scope > .comment-node, :scope > .comment-leaf');
    for (const child of childNodes) {
      propagateNode(child, childCheckedAndEnabled);
    }
  }
}

function handleCheckboxChange(e) {
  if (!e.target.classList.contains('comment-checkbox')) return;
  previewState.hasCustomPruning = true;
  updateCheckboxPropagation();
  rebuildPrompt();
}

function toggleAllCheckboxes(checked) {
  const checkboxes = els.commentsTreeContainer?.querySelectorAll('.comment-checkbox');
  if (!checkboxes) return;
  for (const cb of checkboxes) {
    cb.checked = checked;
  }
  previewState.hasCustomPruning = true;
  updateCheckboxPropagation();
  rebuildPrompt();
}

function getSelectedCommentIds() {
  const selectedIds = [];
  if (!els.commentsTreeContainer) return selectedIds;
  const checkboxes = els.commentsTreeContainer.querySelectorAll('.comment-checkbox');
  for (const cb of checkboxes) {
    if (cb.checked && !cb.disabled) {
      selectedIds.push(cb.getAttribute('data-id'));
    }
  }
  return selectedIds;
}
