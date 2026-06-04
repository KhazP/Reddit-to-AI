async function main() {
  const url = 'https://www.reddit.com/r/AskReddit/comments/1tw2uld/anyone_who_surfed_the_early_web_between_19952010.json?raw_json=1';
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json'
      }
    });
    const text = await res.text();
    if (text.trim().startsWith('<!')) {
      console.log('Returned HTML! First 200 chars:', text.slice(0, 200));
      return;
    }
    const data = JSON.parse(text);
    console.log('Length:', data.length);
    console.log('Post title:', data[0]?.data?.children?.[0]?.data?.title);
    const comments = data[1]?.data?.children || [];
    console.log('Comments count:', comments.length);
    console.log('Kinds of first 5:', comments.slice(0, 5).map(c => c.kind));
  } catch (err) {
    console.error('Error:', err);
  }
}
main();
