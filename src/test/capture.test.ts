import { beforeEach, describe, expect, it } from 'vitest';
import { captureSelection, cleanText, findPageDefinition, looksLikeAcronym, sentenceAround, UI_HOST_ATTR } from '../content/capture';

function selectNode(node: Node, start?: number, end?: number) {
  const range = document.createRange();
  if (start !== undefined && end !== undefined) {
    range.setStart(node, start);
    range.setEnd(node, end);
  } else {
    range.selectNodeContents(node);
  }
  const sel = window.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);
}

function selectText(el: Element, word: string) {
  const text = el.firstChild as Text;
  const at = text.data.indexOf(word);
  selectNode(text, at, at + word.length);
}

describe('cleanText', () => {
  it('collapses whitespace but keeps line breaks', () => {
    expect(cleanText('  foo\t\tbar  \n\n\n\n baz qux ')).toBe('foo bar\n\nbaz qux');
  });
  it('strips zero-width characters', () => {
    expect(cleanText('in​ter‍net')).toBe('internet');
  });
});

describe('sentenceAround', () => {
  it('returns only the sentence containing the selection', () => {
    const s = sentenceAround('First sentence here. The rower pulled the boat onto the ', 'bank', ' and watched. Next one.');
    expect(s).toBe('The rower pulled the boat onto the bank and watched.');
  });
  it('does not insert spaces inside a partially selected word', () => {
    expect(sentenceAround('The un', 'believable', ' story.')).toBe('The unbelievable story.');
  });
  it('handles no surrounding text', () => {
    expect(sentenceAround('', 'hello', '')).toBe('hello');
  });
});

describe('captureSelection', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    window.getSelection()?.removeAllRanges();
    document.title = 'Test page';
  });

  it('captures exactly the selected word, never the neighbouring line', () => {
    document.body.innerHTML = `
      <article>
        <h2>Rivers</h2>
        <p id="a">Line above mentions money and loans.</p>
        <p id="b">The rower pulled the boat onto the bank and watched the river rise.</p>
        <p id="c">Line below mentions interest rates.</p>
      </article>`;
    selectText(document.getElementById('b')!, 'bank');
    const cap = captureSelection()!;
    expect(cap.text).toBe('bank');
    expect(cap.sentence).toBe('The rower pulled the boat onto the bank and watched the river rise.');
    expect(cap.context).toContain('Section: Rivers');
    expect(cap.pageTitle).toBe('Test page');
    expect(cap.truncated).toBe(false);
  });

  it('captures a selection spanning inline elements', () => {
    document.body.innerHTML = `<p id="p">Use <code>useMemo</code> to <em>memoize</em> values.</p>`;
    const p = document.getElementById('p')!;
    const range = document.createRange();
    range.setStart(p.childNodes[1].firstChild!, 0);
    range.setEnd(p.childNodes[3].firstChild!, 7);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    const cap = captureSelection()!;
    expect(cap.text).toBe('useMemo to memoize');
    expect(cap.sentence).toBe('Use useMemo to memoize values.');
  });

  it('trims trailing whitespace from a double-click style selection', () => {
    document.body.innerHTML = `<p id="p">An idempotent write is safe to retry.</p>`;
    const t = document.getElementById('p')!.firstChild as Text;
    selectNode(t, 3, 14); // "idempotent "
    expect(captureSelection()!.text).toBe('idempotent');
  });

  it('returns null for an empty or whitespace-only selection', () => {
    document.body.innerHTML = `<p id="p">Hello   world</p>`;
    const t = document.getElementById('p')!.firstChild as Text;
    selectNode(t, 5, 8);
    expect(captureSelection()).toBeNull();
    window.getSelection()!.removeAllRanges();
    expect(captureSelection()).toBeNull();
  });

  it('reads selections inside a textarea', () => {
    document.body.innerHTML = `<label for="t">Notes</label><textarea id="t">The contract includes an indemnification clause that survives termination.</textarea>`;
    const ta = document.getElementById('t') as HTMLTextAreaElement;
    ta.focus();
    const at = ta.value.indexOf('indemnification');
    ta.setSelectionRange(at, at + 'indemnification clause'.length);
    const cap = captureSelection()!;
    expect(cap.text).toBe('indemnification clause');
    expect(cap.sentence).toContain('The contract includes an indemnification clause');
    expect(cap.context).toContain('Notes');
  });

  it('ignores selections inside Glossa’s own UI', () => {
    document.body.innerHTML = `<div ${UI_HOST_ATTR}><span id="s">Explain</span></div>`;
    selectNode(document.getElementById('s')!);
    expect(captureSelection()).toBeNull();
  });

  it('truncates very long selections and flags it', () => {
    document.body.innerHTML = `<p id="p">${'word '.repeat(1200)}</p>`;
    selectNode(document.getElementById('p')!);
    const cap = captureSelection()!;
    expect(cap.text.length).toBe(4000);
    expect(cap.truncated).toBe(true);
    expect(cap.context.length).toBeLessThanOrEqual(1802);
  });

  it('keeps line structure for multi-line code selections', () => {
    document.body.innerHTML = `<pre id="p">const a = 1;\nconst b = 2;</pre>`;
    selectNode(document.getElementById('p')!);
    expect(captureSelection()!.text).toBe('const a = 1;\nconst b = 2;');
  });

  it('captures non-Latin text', () => {
    document.body.innerHTML = `<p id="p">これは難しい言葉です。</p>`;
    const t = document.getElementById('p')!.firstChild as Text;
    selectNode(t, 3, 5);
    expect(captureSelection()!.text).toBe('難し');
  });
});

describe('findPageDefinition', () => {
  it('spots acronyms the page spells out first', () => {
    const page = 'Banks reported a higher Net Interest Margin (NIM) this quarter. Later, NIM fell again.';
    expect(findPageDefinition('NIM', page)).toBe('Net Interest Margin (NIM)');
  });
  it('skips small words and leading noise', () => {
    const page = 'Minutes from the meeting of the Federal Open Market Committee (FOMC) were released.';
    expect(findPageDefinition('FOMC', page)).toBe('Federal Open Market Committee (FOMC)');
  });
  it('handles camel-case words and plural acronyms', () => {
    expect(findPageDefinition('JSON', 'Data is sent as JavaScript Object Notation (JSON).')).toBe('JavaScript Object Notation (JSON)');
    expect(findPageDefinition('KPIs', 'Track your key performance indicators (KPIs) weekly.')).toBe('key performance indicators (KPI)');
  });
  it('spots the acronym-first form', () => {
    expect(findPageDefinition('SLA', 'Our SLA (the service level agreement) covers uptime.')).toBe('SLA (the service level agreement)');
  });
  it('ignores parentheses whose words do not spell the acronym', () => {
    expect(findPageDefinition('NIM', 'The NIM (see table 2) rose. Revenue (NIM) grew.')).toBeUndefined();
  });
  it('finds contract-style definitions', () => {
    const page = 'In this Agreement, “Confidential Information” means any non-public information disclosed by either party; it excludes…';
    expect(findPageDefinition('Confidential Information', page)).toBe('“Confidential Information” means any non-public information disclosed by either party');
    expect(findPageDefinition('Company', 'This lease is made with Acme Holdings Inc. (the "Company") today.')).toBe('This lease is made with Acme Holdings Inc. (the "Company")');
  });
  it('returns nothing for long selections or undefined terms', () => {
    expect(findPageDefinition('a whole sentence that is far too long to be a term', 'x')).toBeUndefined();
    expect(findPageDefinition('bank', 'The boat reached the bank.')).toBeUndefined();
  });
  it('recognises acronym shapes', () => {
    expect(looksLikeAcronym('NIM')).toBe(true);
    expect(looksLikeAcronym('SaaS')).toBe(true);
    expect(looksLikeAcronym('R&D')).toBe(true);
    expect(looksLikeAcronym('Bank')).toBe(false);
    expect(looksLikeAcronym('A')).toBe(false);
  });
});
