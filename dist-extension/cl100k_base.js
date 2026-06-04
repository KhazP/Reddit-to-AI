// Pure JS cl100k-base BPE tokenizer (Tiktoken) implementation
(function attachTiktoken(global) {
  // Base64 to Uint8Array decoder helper (offline, no external package)
  function base64ToBytes(str) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const lookup = new Uint8Array(256);
    for (let i = 0; i < chars.length; i++) {
      lookup[chars.charCodeAt(i)] = i;
    }

    let bufferLength = Math.floor((str.length * 3) / 4);
    if (str.endsWith('==')) {
      bufferLength -= 2;
    } else if (str.endsWith('=')) {
      bufferLength -= 1;
    }

    const bytes = new Uint8Array(bufferLength);
    let p = 0;
    for (let i = 0; i < str.length; i += 4) {
      const encoding1 = lookup[str.charCodeAt(i)];
      const encoding2 = lookup[str.charCodeAt(i + 1)];
      const encoding3 = lookup[str.charCodeAt(i + 2)];
      const encoding4 = lookup[str.charCodeAt(i + 3)];

      bytes[p++] = (encoding1 << 2) | (encoding2 >> 4);
      if (p < bufferLength) {
        bytes[p++] = ((encoding2 & 15) << 4) | (encoding3 >> 2);
      }
      if (p < bufferLength) {
        bytes[p++] = ((encoding3 & 3) << 6) | encoding4;
      }
    }
    return bytes;
  }

  function bytePairMerge(piece, ranks) {
    let parts = Array.from(
      { length: piece.length },
      (_, i) => ({ start: i, end: i + 1 })
    );
    while (parts.length > 1) {
      let minRank = null;
      for (let i = 0; i < parts.length - 1; i++) {
        const slice = piece.slice(parts[i].start, parts[i + 1].end);
        const rank = ranks.get(slice.join(","));
        if (rank == null)
          continue;
        if (minRank == null || rank < minRank[0]) {
          minRank = [rank, i];
        }
      }
      if (minRank != null) {
        const i = minRank[1];
        parts[i] = { start: parts[i].start, end: parts[i + 1].end };
        parts.splice(i + 1, 1);
      } else {
        break;
      }
    }
    return parts;
  }

  function bytePairEncode(piece, ranks) {
    if (piece.length === 1)
      return [ranks.get(piece.join(","))];
    return bytePairMerge(piece, ranks)
      .map((p) => ranks.get(piece.slice(p.start, p.end).join(",")))
      .filter((x) => x != null);
  }

  function escapeRegex(str) {
    return str.replace(/[\\^$*+?.()|[\]{}]/g, "\\$&");
  }

  class Tiktoken {
    constructor(ranks, extendedSpecialTokens) {
      this.patStr = ranks.pat_str;
      this.textEncoder = new TextEncoder();
      this.textDecoder = new TextDecoder("utf-8");
      this.rankMap = new Map();
      this.textMap = new Map();

      // Split the single-line space-separated ranks
      const parts = ranks.bpe_ranks.split(" ");
      const offset = Number.parseInt(parts[1], 10);
      const tokens = parts.slice(2);

      tokens.forEach((token, i) => {
        const bytes = base64ToBytes(token);
        this.rankMap.set(bytes.join(","), offset + i);
        this.textMap.set(offset + i, bytes);
      });

      this.specialTokens = { ...ranks.special_tokens, ...extendedSpecialTokens };
      this.inverseSpecialTokens = Object.entries(this.specialTokens).reduce((memo, [text, rank]) => {
        memo[rank] = this.textEncoder.encode(text);
        return memo;
      }, {});
    }

    static specialTokenRegex(tokens) {
      return new RegExp(tokens.map((i) => escapeRegex(i)).join("|"), "g");
    }

    encode(text, allowedSpecial = [], disallowedSpecial = "all") {
      const regexes = new RegExp(this.patStr, "ug");
      const specialRegex = Tiktoken.specialTokenRegex(
        Object.keys(this.specialTokens)
      );
      const ret = [];
      const allowedSpecialSet = new Set(
        allowedSpecial === "all" ? Object.keys(this.specialTokens) : allowedSpecial
      );
      const disallowedSpecialSet = new Set(
        disallowedSpecial === "all" ? Object.keys(this.specialTokens).filter(
          (x) => !allowedSpecialSet.has(x)
        ) : disallowedSpecial
      );

      if (disallowedSpecialSet.size > 0) {
        const disallowedSpecialRegex = Tiktoken.specialTokenRegex([
          ...disallowedSpecialSet
        ]);
        const specialMatch = text.match(disallowedSpecialRegex);
        if (specialMatch != null) {
          throw new Error(
            `The text contains a special token that is not allowed: ${specialMatch[0]}`
          );
        }
      }

      let start = 0;
      while (true) {
        let nextSpecial = null;
        let startFind = start;
        while (true) {
          specialRegex.lastIndex = startFind;
          nextSpecial = specialRegex.exec(text);
          if (nextSpecial == null || allowedSpecialSet.has(nextSpecial[0]))
            break;
          startFind = nextSpecial.index + 1;
        }
        const end = nextSpecial?.index ?? text.length;
        for (const match of text.substring(start, end).matchAll(regexes)) {
          const piece = this.textEncoder.encode(match[0]);
          const token2 = this.rankMap.get(piece.join(","));
          if (token2 != null) {
            ret.push(token2);
            continue;
          }
          ret.push(...bytePairEncode(piece, this.rankMap));
        }
        if (nextSpecial == null)
          break;
        let token = this.specialTokens[nextSpecial[0]];
        ret.push(token);
        start = nextSpecial.index + nextSpecial[0].length;
      }
      return ret;
    }

    decode(tokens) {
      const res = [];
      let length = 0;
      for (let i2 = 0; i2 < tokens.length; ++i2) {
        const token = tokens[i2];
        const bytes = this.textMap.get(token) ?? this.inverseSpecialTokens[token];
        if (bytes != null) {
          res.push(bytes);
          length += bytes.length;
        }
      }
      const mergedArray = new Uint8Array(length);
      let i = 0;
      for (const bytes of res) {
        mergedArray.set(bytes, i);
        i += bytes.length;
      }
      return this.textDecoder.decode(mergedArray);
    }
  }

  global.Tiktoken = Tiktoken;

  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {
    global.R2ATiktokenPromise = fetch(chrome.runtime.getURL('cl100k_base.json'))
      .then(res => res.json())
      .then(ranks => {
        global.R2ATiktoken = new Tiktoken(ranks);
        return global.R2ATiktoken;
      })
      .catch(err => {
        console.error('Failed to load cl100k_base.json in extension:', err);
      });
  } else {
    global.R2ATiktokenPromise = (async () => {
      try {
        const fs = await import('node:fs/promises');
        let data;
        try {
          data = await fs.readFile('./cl100k_base.json', 'utf8');
        } catch {
          // fallback if run from tests/
          data = await fs.readFile('../cl100k_base.json', 'utf8');
        }
        const ranks = JSON.parse(data);
        global.R2ATiktoken = new Tiktoken(ranks);
        return global.R2ATiktoken;
      } catch (err) {
        console.error('Failed to load cl100k_base.json in Node.js:', err);
      }
    })();
  }
})(typeof globalThis !== 'undefined' ? globalThis : window);
