import pkginfo = require("npm-registry-package-info");
import packagejson = require("package-json");
import { readFileSync, writeFileSync } from "fs";
import util = require("util");


interface PkgData {
  versions: { [key: string]: packagejson.AbbreviatedVersion };
}
type PkgDataInfo = { [key: string]: PkgData };

const sleep: (number: number) => Promise<void> = msec => new Promise<void>(resolve => setTimeout(resolve, msec));

const getPackageInfo = async (opt: pkginfo.Options, sleeptime, count = 0): Promise<PkgDataInfo> => {
  try {
    await sleep(sleeptime * 50);
    const func = util.promisify(pkginfo);
    const s = sleep(60000);
    const result = await Promise.race([s, func(opt).then(v => v.data)]);
    if (result == undefined) {
      throw Error("timeout!");
    }
    return result;
  } catch {
    if (count > 3) {
      console.log(`failed: ${opt.packages[0]},${opt.packages[1]},...`);
      return {};
    }
    console.log(`retry: ${opt.packages[0]},${opt.packages[1]},...`);
    await sleep(500);
    return getPackageInfo(opt, sleeptime, count + 1);
  }
};

const PERNUM = 25;
const MAX = 20000;
const main = async () => {
  // 引数からファイル番号を受け取れるように
  const start = process.argv.length > 2 ? Number(process.argv[2]) : 0
  const v = JSON.parse(readFileSync("all-the-package-names/names.json").toString()) as string[];
  const separte = Math.floor(v.length / MAX);
  console.log(`package count: ${v.length},file count: ${separte}`);
  for (let count = start; count <= separte; count++) {
    console.log(`start ${count}/${separte}`);
    const start = count * MAX;
    const goal = (count + 1) * MAX - 1 > v.length ? v.length - 1 : (count + 1) * MAX - 1;
    console.log(start, goal);
    const arr: Promise<PkgDataInfo>[] = [];
    let sleeptime = 0;
    for (let i = start; i < goal; i += PERNUM) {
      const option: pkginfo.Options = {
        packages: v.slice(i, i + PERNUM > goal ? goal : i + PERNUM).map(x => encodeURIComponent(x))
      };
      arr.push(
        getPackageInfo(option, sleeptime).then(v => {
          console.log(`end: ${i}`);
          return v;
        })
      );
      sleeptime++;
    }
    console.log("start all promises...");
    await Promise.all(arr)
      .then(v => {
        console.log(`fetch all library... ${v.length}`);
        const result = v
          .filter(x => x !== undefined && x !== null)
          .map(x =>
            Array.from(Object.keys(x))
              .filter(name => x[name].versions) // package name array
              .map(name => ({
                name: name,
                versions: Array.from(Object.keys(x[name].versions)).map(version => ({
                  version: version,
                  dep: x[name].versions[version].dependencies
                }))
              }))
          )
          .reduce((p, v) => p.concat(v), []);
        console.log("writing file...");
        writeFileSync(`result/${count}.json`, JSON.stringify(result, null, 4));
      })
      .catch(v => {
        console.log(`error: ${v}`);
      });
  }
};

main();
