import packagejson = require("package-json");
import { readFileSync, writeFileSync } from "fs";
import fetch from "node-fetch";
import { configure, getLogger } from "log4js";
import dayjs from "dayjs";

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
const fetchPkg = async (name: string, count = 0): Promise<Data> => {
  try {
    return await fetch(url(name))
      .then(v => v.json())
      .then(v => ({ name: name, data: v } as Data));
  } catch {
    if (count > 5) {
      logger.error(`error on request ${name} package 5 times`);
      return { name, data: {} };
    }
    await sleep(300);
    return fetchPkg(name, count++);
  }
};

const convertData = (data: Data) => {
  try {
    const pkgData = data.data;
    if (pkgData["versions"] !== undefined && pkgData["versions"] !== null) {
      const d = pkgData as PkgData;
      return {
        name: data.name,
        versions: Array.from(Object.keys(d.versions)).map(version => ({
          version: version,
          dep: d.versions[version].dependencies
        }))
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
  for (let i = 0; i < names.length; i++) {
    arr.push(
      sleep(sleeptime)
        .then(_ => fetchPkg(names[i]))
        .then(v => {
          complete += 1;
          if (complete % 1000 == 0) logger.info(`end ${complete}/${names.length}`);
          return v;
        })
    );
    sleeptime += interval;
  }
  return arr;
};

const writeToFileAndReturnErrors = (e: Data[], index: number): string[] => {
  const result = e.map(x => convertData(x));
  const errors: string[] = result.filter<string>((v): v is string => typeof v == "string");
  const ok = result.filter(v => typeof v != "string");
  if (errors.length > 1) logger.error(`error on request ${errors.length} package: ${errors.join(",")}`);
  logger.info(`ok: ${ok.length}, error: ${errors.length}`);
  logger.info(`writing into file ${ok.length} packages`);
  writeFileSync(`result/${index}.json`, JSON.stringify(ok));
  return errors;
};

const MAX = 20000;
const main = async (): Promise<void> => {
  // 引数からファイル番号を受け取れるように
  const start = process.argv.length > 2 ? Number(process.argv[2]) : 0;
  const names = JSON.parse(readFileSync("all-the-package-names/names.json").toString()) as string[];
  const separte = Math.floor(names.length / MAX);
  logger.info(`package count: ${names.length},file count: ${separte}`);
  for (let count = start; count <= separte; count++) {
    const start = count * MAX;
    const goal = (count + 1) * MAX - 1 > names.length ? names.length - 1 : (count + 1) * MAX - 1;
    logger.info(`start ${count}/${separte}: ${start} -> ${goal} (${goal - start})`);
    const arr = requests(names.slice(start, goal));
    await Promise.all(arr).then(v => writeToFileAndReturnErrors(v, count));
  }
};

configure({
  appenders: { "get-all": { type: "file", filename: `logs/log_${dayjs().format("YYYYMMDD_HHmmss")}.log` } },
  categories: { default: { appenders: ["get-all"], level: "info" } }
});
main();
