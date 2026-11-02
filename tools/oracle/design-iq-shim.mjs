import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { MAIN_ROOT } from './lib/paths.mjs';

const main = await import(pathToFileURL(join(MAIN_ROOT, 'dist', 'index.js')).href);

const log = (entry) => appendFileSync(process.env.DESIGN_IQ_LOG, `${JSON.stringify(entry)}\n`);

function callSite() {
  return /([\w-]+\.test\.ts):(\d+)/.exec(new Error().stack)?.slice(1).join(':');
}

function refusalOf(error) {
  return { code: error.code, category: error.category, message: error.message, details: error.details };
}

function isPromise(value) {
  return typeof value?.then === 'function';
}

function spiedValidator(validator, answers) {
  const validate = (xml, context) => {
    const remember = (findings) => {
      answers.push({ validator: validator.name, phase: context.phase, xml, findings });
      return findings;
    };
    const answer = validator.validate(xml, context);
    return isPromise(answer) ? answer.then(remember) : remember(answer);
  };
  return { ...validator, validate };
}

function spiedArguments(args, answers) {
  return args.map((argument) => {
    if (!Array.isArray(argument?.validators)) {
      return argument;
    }
    return { ...argument, validators: argument.validators.map((validator) => spiedValidator(validator, answers)) };
  });
}

function plainArguments(args) {
  return args.map((argument) => {
    if (!Array.isArray(argument?.validators)) {
      return argument;
    }
    const validators = argument.validators.map(({ name, detail, blocks }) => ({ name, detail, blocks }));
    return { ...argument, validators };
  });
}

function logged(name, target) {
  return (...args) => {
    const answers = [];
    const entry = { type: 'call', function: name, site: callSite(), written: process.env.DESIGN_IQ_WRITTEN_ROW, args: plainArguments(args) };
    const answered = (answer) => {
      log({ ...entry, validators: answers, answer });
      return answer;
    };
    const refused = (error) => {
      log({ ...entry, validators: answers, refused: refusalOf(error) });
      throw error;
    };
    try {
      const answer = target(...spiedArguments(args, answers));
      return isPromise(answer) ? answer.then(answered, refused) : answered(answer);
    } catch (error) {
      return refused(error);
    }
  };
}

function readLogged(value, path) {
  if (typeof value !== 'object' || value === null) {
    return value;
  }
  return new Proxy(value, {
    get(target, key, receiver) {
      const child = Reflect.get(target, key, receiver);
      if (typeof key === 'symbol' || typeof child === 'function') {
        return child;
      }
      log({ type: 'read', path: [...path, key] });
      return readLogged(child, [...path, key]);
    },
    ownKeys(target) {
      log({ type: 'keys', path });
      return Reflect.ownKeys(target);
    },
  });
}

export * from '../../.oracle/main/dist/index.js';
export const applyToXml = logged('applyToXml', main.applyToXml);
export const layoutXml = logged('layoutXml', main.layoutXml);
export const showXml = logged('showXml', main.showXml);
export const findXml = logged('findXml', main.findXml);
export const validateXml = logged('validateXml', main.validateXml);
export const kindsJson = logged('kindsJson', main.kindsJson);
export const mutationSummary = logged('mutationSummary', main.mutationSummary);
export const OPS_SCHEMA = readLogged(main.OPS_SCHEMA, []);
