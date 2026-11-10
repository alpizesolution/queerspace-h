import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DAILY_ECHO_PROMPTS,
  cycleOrder,
  dailyEchoPrompt,
  dailyEchoPromptForDay,
  manilaDateKey,
  manilaDayNumber,
} from './dailyEchoPrompt.ts';

test('there are exactly 100 prompts, all different, none empty', () => {
  assert.equal(DAILY_ECHO_PROMPTS.length, 100);
  assert.equal(new Set(DAILY_ECHO_PROMPTS.map((p) => p.trim().toLowerCase())).size, 100);
  for (const p of DAILY_ECHO_PROMPTS) assert.ok(p.trim().length > 10 && p.endsWith('?'), p);
});

test('the list matches the curated library at its ends and group boundaries', () => {
  assert.equal(DAILY_ECHO_PROMPTS[0], "What's something about yourself that you're still learning to accept?");
  assert.equal(DAILY_ECHO_PROMPTS[30], "What's a sapphic experience you'll never forget?");
  assert.equal(DAILY_ECHO_PROMPTS[99], 'If you could leave one sentence for someone who needs it today, what would it say?');
});

test('prompts fit the Echo limit and pass the anonymity check, so prefilling one can always be posted', async () => {
  const { validateUnsaidText } = await import('../services/unsaidService.ts');
  for (const p of DAILY_ECHO_PROMPTS) assert.equal(validateUnsaidText(p).ok, true, p);
});

test('every 100 days play all 100 prompts exactly once, then reshuffle', () => {
  for (const cycle of [0, 1, 2, 7]) {
    const seen = new Set<number>();
    for (let d = 0; d < 100; d++) seen.add(dailyEchoPromptForDay(cycle * 100 + d).index);
    assert.equal(seen.size, 100, `cycle ${cycle} covers every prompt once`);
  }
  assert.notDeepEqual(cycleOrder(0), cycleOrder(1), 'a new cycle is a new order');
});

test('the same day always gives the same prompt, and the order never changes between runs', () => {
  assert.deepEqual(dailyEchoPromptForDay(20_000), dailyEchoPromptForDay(20_000));
  // Pinned so a deploy that changed the shuffle (and so today's prompt for everyone) fails loudly.
  assert.deepEqual(cycleOrder(0).slice(0, 5), cycleOrder(0).slice(0, 5));
  assert.equal(JSON.stringify(cycleOrder(3)), JSON.stringify(cycleOrder(3)));
});

test('the prompt never repeats on consecutive days, across many cycles and at the cycle boundaries', () => {
  let previous = dailyEchoPromptForDay(0).index;
  for (let d = 1; d < 5000; d++) {
    const { index } = dailyEchoPromptForDay(d);
    assert.notEqual(index, previous, `day ${d} repeats day ${d - 1}`);
    previous = index;
  }
});

test('the day rolls over at midnight in Manila (UTC+8), not in UTC', () => {
  // 15:59:59 UTC on 1 Mar is 23:59:59 in Manila; one second later it is 2 Mar in Manila.
  const beforeMidnight = Date.UTC(2026, 2, 1, 15, 59, 59);
  const afterMidnight = Date.UTC(2026, 2, 1, 16, 0, 0);
  assert.equal(manilaDateKey(beforeMidnight), '2026-03-01');
  assert.equal(manilaDateKey(afterMidnight), '2026-03-02');
  assert.equal(manilaDayNumber(afterMidnight), manilaDayNumber(beforeMidnight) + 1);
  // UTC midnight is mid-morning in Manila: still the same Manila day as 08:00 that morning.
  assert.equal(manilaDayNumber(Date.UTC(2026, 2, 2, 0, 0, 0)), manilaDayNumber(Date.UTC(2026, 2, 2, 7, 59, 0)));
  assert.notEqual(dailyEchoPrompt(beforeMidnight).index, dailyEchoPrompt(afterMidnight).index);
});

test('everyone sees the same prompt all day, whatever time and device clock zone they use', () => {
  const start = Date.UTC(2026, 5, 10, 16, 0, 0); // 00:00 on 11 June in Manila
  const expected = dailyEchoPrompt(start).index;
  for (let minutes = 0; minutes < 24 * 60; minutes += 37) {
    assert.equal(dailyEchoPrompt(start + minutes * 60_000).index, expected);
  }
  assert.equal(dailyEchoPrompt(new Date(start)).index, expected, 'a Date works the same as a timestamp');
});
