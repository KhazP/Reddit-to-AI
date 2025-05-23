// Minimal service_worker.js for testing

console.log('Minimal Service Worker: Script loaded.');

chrome.runtime.onInstalled.addListener(() => {
  console.log('Minimal Service Worker: Extension Installed.');
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('Minimal Service Worker: Message received:', request);
  if (request.action === 'ping') {
    sendResponse({ status: 'pong' });
  }
  return true; // Keep message channel open for async response
});

console.log('Minimal Service Worker: Event listeners registered.');
