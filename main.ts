import packagejson = require("package-json");
import { readFileSync, writeFileSync } from "fs";
import fetch from "node-fetch";

interface PkgData {
  versions: { [key: string]: packagejson.AbbreviatedVersion };
  name: string;
}
interface Data {
  name: string;
  data: PkgData;
}

const sleep: (number: number) => Promise<void> = msec => new Promise<void>(resolve => setTimeout(resolve, msec));

const url = (name: string): string => `https://registry.npmjs.org/${encodeURIComponent(name)}`;
const fetchPkg = async (name: string): Promise<Data> => {
  try {
    return await fetch(url(name))
      .then(v => v.json())
      .then(v => ({ name: name, data: v } as Data));
  } catch {
    await sleep(300);
    console.log(`retry: ${name}`);
    return fetchPkg(name);
  }
};

const convertData = (data: Data) => {
  try {
    const pkgData = data.data;
    return {
      name: pkgData.name,
      versions: Array.from(Object.keys(pkgData.versions)).map(version => ({
        version: version,
        dep: pkgData.versions[version].dependencies
      }))
    };
  } catch {
    return data.name;
  }
};

const MAX = 20000;
const main = async (): Promise<void> => {
  // 引数からファイル番号を受け取れるように
  const start = process.argv.length > 2 ? Number(process.argv[2]) : 0;
  const names = JSON.parse(readFileSync("all-the-package-names/names.json").toString()) as string[];
  const separte = Math.floor(names.length / MAX);
  console.log(`package count: ${names.length},file count: ${separte}`);
  for (let count = start; count <= separte; count++) {
    console.log(`start ${count}/${separte}`);
    const start = count * MAX;
    const goal = (count + 1) * MAX - 1 > names.length ? names.length - 1 : (count + 1) * MAX - 1;
    console.log(start, goal);
    const arr: Promise<Data>[] = [];
    let sleeptime = 0;
    let complete = 0;
    for (let i = start; i < goal; i++) {
      arr.push(
        sleep(sleeptime)
          .then(_ => fetchPkg(names[i]))
          .then(v => {
            complete += 1;
            if (complete % 1000 == 0) console.log(`end ${complete}/${goal - start}`);
            return v;
          })
      );
      sleeptime += 5;
    }
    console.log("start all promises...");
    await Promise.all(arr)
      .then(v => {
        const result = v.map(x => convertData(x));
        const errors = result.filter(v => typeof v == "string");
        const ok = result.filter(v => typeof v != "string");
        console.log(`error on request ${errors.length} package: ${errors.join(",")}`);
        console.log("writing file...");
        writeFileSync(`result/${count}.json`, JSON.stringify(ok));
      })
      .catch(v => {
        console.log(`error: ${v}`);
      });
  }
};

main();
