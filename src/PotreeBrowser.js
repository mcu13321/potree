// Syntax lowering does not provide runtime APIs; install Array.at in this window's realm.
import 'core-js/modules/es.array.at.js';

// Preserve the existing public namespace while keeping the source-module entry independent.
export * from './Potree.js';
