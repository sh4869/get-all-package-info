import pkginfo = require("npm-registry-package-info");
import packagejson = require("package-json");
import { writeFileSync } from "fs";
import util = require("util");
import names = require("./names.json");

interface PkgData {
  versions: { [key: string]: packagejson.AbbreviatedVersion };
}
type PkgDataInfo = { [key: string]: PkgData };

const sleep: (number: number) => Promise<void> = msec => new Promise<void>(resolve => setTimeout(resolve, msec));

const getPackageInfo = async (opt: pkginfo.Options, count: number = 0): Promise<PkgDataInfo> => {
  try {
    await sleep(Math.random() * 10000);
    const func = util.promisify(pkginfo);
    const result = await func(opt)
      .then(v => v.data)
      .catch(v => {});
    return result;
  } catch {
    if (count > 3) {
      return {};
    }
    console.log(`retry: ${opt.packages[0]}...`);
    await sleep(1000);
    return getPackageInfo(opt, count + 1);
  }
};

const INVALID_PATH_REGEX = /[\u0000-\u0020\u0100-\uffff]/;

const PERNUM = 100;
const MAX = 5000;
const main = async () => {
  const v = names as string[];
  const separte = Math.floor(v.length / MAX);
  console.log(`file count: ${separte}`);
  for (let count = 0; count < separte; count++) {
    console.log(`start ${count} time...`);
    const start = count * MAX;
    const goal = (count + 1) * MAX - 1;
    const arr: Promise<PkgDataInfo>[] = [];
    for (let i = start; i < goal; i += PERNUM) {
      const option: pkginfo.Options = {
        packages: v.slice(i, i + PERNUM > goal ? goal : i + PERNUM).filter(name => !INVALID_PATH_REGEX.test(name))
      };
      arr.push(getPackageInfo(option));
    }
    await Promise.all(arr)
      .then(v => {
        console.log(`fetch all library... ${v.length}`);
        const result = v.filter(x => x !== undefined && x !== null)
          .map(x =>
            Array.from(Object.keys(x)) // package name array
              .map(name => {
                if (x[name].versions) {
                  return {
                    name: name,
                    versions: Array.from(Object.keys(x[name].versions)).map(version => ({
                      version: version,
                      dep: x[name].versions[version].dependencies
                    }))
                  };
                } else {
                  return {};
                }
              })
          )
          .reduce((p, v) => Object.assign(v, p), {});
        console.log("writing file...");
        writeFileSync(`result/${count}.json`, JSON.stringify(result, null, 4));
      })
      .catch(v => {
        console.log(v);
      });
  }
};

main();
