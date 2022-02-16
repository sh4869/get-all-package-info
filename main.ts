import packagejson = require("package-json");
import commandLineArgs, { OptionDefinition } from "command-line-args";
import dayjs from "dayjs";
import { appendFileSync, readFileSync, writeFileSync } from "fs";
import { configure, getLogger } from "log4js";
import fetch from "node-fetch";

interface PkgData {
  versions: { [key: string]: packagejson.AbbreviatedVersion };
  name: string;
}

interface Data {
  name: string;
  data: PkgData | object;
}

const logger = getLogger();

const sleep: (number: number) => Promise<void> = msec => new Promise<void>(resolve => setTimeout(resolve, msec));

const url = (name: string): string => `https://registry.npmjs.org/${encodeURIComponent(name)}`;

class NotFoundError extends Error {}

const fetchPkg = async (name: string, count = 0): Promise<Data> => {
  while (count < 5) {
    try {
      await sleep(10000 * (count - 1));
      return await fetch(url(name), { timeout: 30000 })
        .then(v => {
          if (v.ok) return v.json();
          if (v.status === 404) throw new NotFoundError(`error on package ${name}`);
          else throw new Error("other error");
        })
        .then(v => ({ name: name, data: v } as Data));
    } catch (e) {
      if (e instanceof NotFoundError) {
        count = 5;
      }
      count++;
    }
  }
  return { name, data: {} };
};

const convertData = (data: Data) => {
  try {
    const pkgData = data.data;
    if (pkgData["versions"] !== undefined && pkgData["versions"] !== null) {
      const d = pkgData as PkgData;
      return {
        name: data.name,
        versions: Array.from(Object.keys(d.versions))
          .map(version => {
            const x = d.versions[version];
            let deps;
            if (x.optionalDependencies !== undefined) {
              deps = Object.keys(x.dependencies || {})
                .filter(v => !Object.keys(x.optionalDependencies || {}).includes(v))
                .reduce((obj, key) => {
                  obj[key] = x.dependencies ? x.dependencies[key] : "INVALID";
                  return obj;
                }, {});
            } else {
              deps = x.dependencies;
            }
            return {
              version: version,
              dep: deps,
              shasum: x.dist.shasum,
              integrity: x.dist.integrity
            };
          })
          .filter(v => v.shasum != null)
      };
    } else {
      return data.name;
    }
  } catch {
    return data.name;
  }
};

const requests = (names: string[], interval = 5): Promise<Data>[] => {
  const arr: Promise<Data>[] = [];
  let sleeptime = 0;
  let complete = 0;
  const logTime = names.length / 10;
  for (let i = 0; i < names.length; i++) {
    arr.push(
      sleep(sleeptime)
        .then(_ => fetchPkg(names[i]))
        .then(v => {
          complete += 1;
          if (complete % logTime == 0) logger.info(`end ${complete}/${names.length}`);
          return v;
        })
    );
    sleeptime += interval;
  }
  logger.info(`set up promise array, ${logTime}`);
  return arr;
};

const writeToFileAndReturnErrors = (e: Data[], index: number, dest: string, errorFile: string): string[] => {
  const result = e.map(x => convertData(x));
  const errors: string[] = result.filter<string>((v): v is string => typeof v == "string");
  const ok = result.filter(v => typeof v != "string");
  if (errors.length > 1) {
    logger.error(`error on request ${errors.length} package`);
    appendFileSync(errorFile, errors.join("\n") + "\n");
  }
  logger.info(`ok: ${ok.length}, error: ${errors.length} (${errors[0]},${errors[1]},...)`);
  logger.info(`writing into file ${ok.length} packages`);
  writeFileSync(`${dest}/${index}.json`, JSON.stringify(ok));
  return errors;
};

const argOptions: OptionDefinition[] = [
  { name: "name-file", defaultValue: "all-the-package-names/names.json", type: String },
  { name: "error-file", defaultValue: "errorlist", type: String },
  { name: "dest", defaultValue: "result", type: String },
  { name: "retry-error", defaultValue: true, type: Boolean },
  { name: "start", defaultValue: 0, type: Number },
  { name: "max", defaultValue: 20000, type: Number },
  { name: "skip-main", defaultValue: false, type: Boolean }
];

const options = commandLineArgs(argOptions);

const MAX = options["max"];

const main = async (): Promise<void> => {
  const start = options["start"];
  const names = JSON.parse(readFileSync(options["name-file"]).toString()) as string[];
  const separte = Math.floor(names.length / MAX);
  logger.info(`package count: ${names.length},file count: ${separte}`);
  if (!options["skip-main"]) {
    for (let count = start; count <= separte; count++) {
      const start = count * MAX;
      const goal = Math.min(names.length, (count + 1) * MAX);
      logger.info(`start ${count}/${separte}: ${start} -> ${goal} (${goal - start})`);
      const arr = requests(names.slice(start, goal), 5);
      await Promise.all(arr).then(v => writeToFileAndReturnErrors(v, count, options["dest"], options["error-file"]));
    }
  }
  // エラーをやるやつ
  if (options["retry-error"]) {
    const ERROR_MAX = 2000;
    const errorPackages = readFileSync(options["error-file"])
      .toString()
      .split("\n")
      .filter((v, i, a) => a.indexOf(v) === i);
    logger.info(`error package count: ${errorPackages.length}`);
    const s = Math.floor(errorPackages.length / ERROR_MAX);
    for (let count = 0; count <= s; count++) {
      const start = count * ERROR_MAX;
      const goal = Math.min((count + 1) * ERROR_MAX, errorPackages.length);
      logger.info(`start error ${count + separte + 1}/${s + separte + 1}: ${start} -> ${goal}`);
      const arr = requests(errorPackages.slice(start, goal), 200);
      await Promise.all(arr).then(v =>
        writeToFileAndReturnErrors(v, count + separte + 1, options["dest"], options["error-file"])
      );
    }
  }
};

configure({
  appenders: { "get-all": { type: "file", filename: `logs/log_${dayjs().format("YYYYMMDD_HHmmss")}.log` } },
  categories: { default: { appenders: ["get-all"], level: "info" } }
});
main();
