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
  sendInFlight: false
};

const els = {};

document.addEventListener('DOMContentLoaded', async () => {
  if (typeof initI18n === 'function') {
    await initI18n();
    localizeHtmlPage();
  }

  bindElements();
  bindEvents();
  loadPreviewData();
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
  els.exportBtn = document.getElementById('exportBtn');
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
}

function bindEvents() {
  [els.contextPresetSelect, els.trimStrategySelect, els.mediaModeSelect, els.outputFormatSelect].forEach(select => {
    select?.addEventListener('change', () => {
      previewState.dirty = false;
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
  els.exportBtn?.addEventListener('click', exportPrompt);
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
    previewState.template = previewState.settings.defaultPromptTemplate || 'Please analyze the following Reddit thread.\n\n{content}';

    els.contextPresetSelect.value = previewState.settings.contextPreset || 'balanced';
    els.trimStrategySelect.value = previewState.settings.trimStrategy || response.data.filtersApplied?.trimStrategy || 'top';
    els.mediaModeSelect.value = previewState.settings.mediaMode || 'attach';
    els.providerSelect.value = previewState.settings.selectedLlmProvider || 'gemini';
    els.outputFormatSelect.value = previewState.settings.outputFormat || 'auto';
    if (els.skipPreviewToggle) els.skipPreviewToggle.checked = previewState.settings.showPromptPreview === false;

    updateThreadMeta();
    rebuildPrompt();
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
  const renderedData = R2AIPrompt.applyContextPreset(previewState.data, options.contextPreset, options);
  const prompt = R2AIPrompt.buildPromptText(renderedData, previewState.template, {
    ...options,
    contextPreset: null
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
  const names = { gemini: 'Gemini', chatgpt: 'ChatGPT', claude: 'Claude', aistudio: 'AI Studio' };
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

function exportPrompt() {
  const exportData = {
    exportedAt: new Date().toISOString(),
    prompt: els.promptTextarea.value,
    settings: getCurrentBuildOptions(),
    data: previewState.renderedData || previewState.data
  };
  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  const subreddit = previewState.data?.post?.subreddit || 'multi-thread';
  anchor.href = url;
  anchor.download = `reddit-to-ai-preview-${subreddit}-${Date.now()}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
  setStatus('Preview exported as JSON.');
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
