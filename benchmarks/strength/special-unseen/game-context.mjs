import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

assert.ok(process.env.GAME_REPO, 'Set GAME_REPO to the shogi-is-luck checkout used for rule validation.');
export const gameRepo=resolve(process.env.GAME_REPO);
export const {toSfen,toUsi}=await import(pathToFileURL(resolve(gameRepo,'ai/rsshogi-position.mjs')).href);
