import fs from 'fs-promise';
import moment from 'moment';
import chalk from 'chalk';
import _ from 'lodash';
import mime from 'mime-types';
import bluebird from 'bluebird';
import { ExifImage } from 'exif';
import prettyjson from 'prettyjson';

/**
 * @return {Promise<Object>} The exif data, structured like
 *  {
       gps,
       image: {
         Make,
         Model,
         Orientation,
         XResolution,
         YResolution,
         ResolutionUnit,
         Software,
         ModifyDate, // format 'YYYY:MM:DD HH:mm:ss'
       },
       exif: {
         ISO,
         ExifVersion,
         DateTimeOriginal,
         CreateDate,
         ShutterSpeedValue,
         ApertureValue,
         BrightnessValue,
         ExposureCompensation,
         MaxApertureValue,
         MeteringMode,
         Flash,
         FocalLength,
       },
    }
 */
export function getExifData(filePath) {
    return new Promise((resolve, reject) => {
        new ExifImage({ image: filePath }, (error, exifData) => {
            if (error) {
                return reject(error);
            }
            resolve(_.omit(exifData, 'exif.MakerNote'));
        });
    });
}

/**
 * Return exif date string in format 'YYYY:MM:DD HH:mm:ss'
 * @return {Promise<String>} Modification date from exif'
 */
function getExifDateString(filePath) {
    return getExifData(filePath).then(data => {
        return data.image.ModifyDate;
    });
}

export function parseExifDate(dateString) {
    const date = moment(dateString, 'YYYY:MM:DD HH:mm:ss');
    if (!date.isValid()) {
        throw new Error(`Invalid date: ${dateString}. Required format: YYYY:MM:DD HH:mm:ss`);
    }
    return date;
}

function checkDate(item, fix = false) {
    const { path: filePath, stats } = item;
    return getExifDateString(filePath)
        .then(parseExifDate)
        .then(exifDate => {
            const diffs = ['atime', 'mtime', 'ctime', 'birthtime'].map(dateField => {
                const date = stats[dateField];
                const diff = moment.duration(exifDate.diff(date));
                const diffSeconds = diff.asSeconds();
                return {
                    dateField,
                    date,
                    diff,
                    isDiff: diffSeconds !== 0,
                    diffSeconds,
                    diffHuman: diff.humanize(),
                };
            })
            console.log(`${chalk.underline.bold(filePath)}`);
            console.log(`  ${_.padEnd('Exif:', 10)} ${chalk.magenta(exifDate)}`);
            diffs.map(({ dateField, date, isDiff, diffHuman }) => {
                console.log(`  ${_.padEnd(`${dateField}:`, 10)} ${chalk.cyan(date)}`, isDiff ? `${chalk.red('✘')} (${chalk.yellow(diffHuman)})` : chalk.green('✔'));
            });
            const isOk = !diffs[1].isDiff;
            if (!fix || isOk) {
                return isOk;
            }
            const unixDate = exifDate.unix();
            console.log(`  ${chalk.green('Fixing...')}`);
            return fs.utimes(filePath, unixDate, unixDate).then(() => true);
        })
        .catch(err => {
            console.log(chalk.underline.bold(filePath));
            console.log(`  ${chalk.red(err.message)}`);
        });
}

function checkDiff(dirPath, fix = false) {
    console.log(`${fix ? 'Checking and fixing' : 'Checking'} photos in '${dirPath}'...`)
    fs.walk(dirPath).then(items => {
        const files = items.filter(item => {
            const type = mime.lookup(item.path);
            // return item.stats.isFile();
            return type === 'image/jpeg';
        });
        bluebird.mapSeries(files, file => checkDate(file, fix))
            .then((isOk) => {
                const numOk = isOk.filter(isOk => isOk).length;
                console.log(`Done! ${numOk} / ${files.length} is ok.`);
            });
    });
}

function printExif(item) {
    const { path: filePath, stats } = item;
    return getExifData(filePath)
        .then(exif => {
            console.log('\n');
            console.log('=========================');
            console.log(filePath);
            console.log('=========================');
            console.log(prettyjson.render(stats));
            console.log(prettyjson.render(exif));
            return checkDate(item);
        })
        .catch(err => {
            console.error(err);
            return false;
        });
}

function printInfo(dirPath) {
    console.log(`Print info on photo(s) in '${dirPath}'...`);
    fs.walk(dirPath).then(items => {
        const files = items.filter(item => {
            const type = mime.lookup(item.path);
            // return item.stats.isFile();
            return type === 'image/jpeg';
        });
        bluebird.mapSeries(files, file => printExif(file))
            .then((isOk) => {
                const numOk = isOk.filter(isOk => isOk).length;
                console.log(`Done! ${numOk} / ${files.length} is ok.`);
            });
    });

}

const fixDiff = _.partialRight(checkDiff, true);

function run() {
    if (process.argv.length < 3 || process.argv.length > 4) {
        console.log(`Usage: npm run [check|fix|info] [photo dir]`);
        return 0;
    }

    const dir = process.argv.length > 3 ? process.argv[3] : process.argv[2];
    const fix = process.argv.length > 3 && process.argv[2] === '--fix';
    if (process.argv[2] === '--info') {
        printInfo(dir);
        return;
    }
    checkDiff(dir, fix);
}

run();
