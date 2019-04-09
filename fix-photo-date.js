import fs from 'fs';
import globby from 'globby';
import moment from 'moment';
import chalk from 'chalk';
import _ from 'lodash';
import mime from 'mime-types';
import { ExifImage } from 'exif';
import prettyjson from 'prettyjson';
import { exiftool } from 'exiftool-vendored';
import program from 'commander';
import { name, version, description} from './package.json';

async function stat(path) {
    return new Promise((resolve, reject) => {
        fs.stat(path, (err, stats) => {
            if (err) {
                return reject(err);
            }
            return resolve(stats);
        });
    });
}

async function utimes(path, atime, mtime) {
    return new Promise((resolve, reject) => {
        fs.utimes(path, atime, mtime, (err) => {
            if (err) {
                return reject(err);
            }
            return resolve(true);
        });
    });
}

async function getFileItems(glob) {
    const paths = await globby(glob);
    const stats = await Promise.all(paths.map(path => stat(path)));
    const files = paths.map((path, i) => ({
        path,
        stats: stats[i],
        type: mime.lookup(path),
    }));
    return files;
}

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
export function getJpegExifData(filePath) {
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
function getJpegExifDateString(filePath) {
    return getJpegExifData(filePath).then(data => {
        return data.image.ModifyDate;
    });
}

export function parseJpegExifDate(dateString) {
    const date = moment(dateString, 'YYYY:MM:DD HH:mm:ss');
    if (!date.isValid()) {
        throw new Error(`Invalid date: ${dateString}. Required format: YYYY:MM:DD HH:mm:ss`);
    }
    return date;
}

async function getExifDate(filePath) {
    try {
        const tags = await exiftool.read(filePath)
        const date = tags.DateTimeOriginal;
        if (!date) {
            console.log(`Warning: ${filePath} has no original date time, using creation date.`);
            return moment(tags.CreateDate.toISOString());
        }
        return moment(date.toISOString());
    } catch (err) {
        console.error('Exif tool read error:', err);
        throw err;
    }
}

async function setExifDate(filePath, date) {
    try {
        const tags = await exiftool.write(filePath, {
            AllDates: date.toISOString(),
        });
    } catch (err) {
        console.error('Exif tool write error:', err);
        throw err;
    }
}

async function checkDate(item, { fix = false, referenceDate = undefined, force = false }) {
    const { path: filePath, stats } = item;
    // return getJpegExifDateString(filePath)
    //     .then(parseJpegExifDate)
    try {
        const exifDate = await getExifDate(filePath);
        let exifDateToUse = exifDate;
        let diffToReferenceDate = undefined;
        let datesToCompare = [];
        if (referenceDate) {
            exifDateToUse = referenceDate;
            diffToReferenceDate = moment.duration(exifDate.diff(referenceDate));
            datesToCompare.push(['Exif', exifDate]);
        }
        let unixDates = ['atime', 'mtime', 'ctime', 'birthtime'].map(dateSource => 
            [dateSource, moment(stats[dateSource])]
        );
        datesToCompare.push(...unixDates);
        console.log(`${chalk.underline.bold(filePath)}`);
        console.log(`  ${_.padEnd(referenceDate ? 'Exif (external)' : 'Exif:', 15)} ${chalk.magenta(exifDateToUse)}`);
        let isOk = false;
        datesToCompare.forEach(([dateSource, date]) => {
            const diff = moment.duration(date.diff(exifDateToUse));
            const diffSeconds = diff.asSeconds();
            const isDiff = diffSeconds !== 0;
            if (dateSource === 'mtime') {
                isOk = !isDiff;
            }
            const diffHuman = `${diff < 0 ? '-' : ''}${diff.humanize()}`;
            console.log(`  ${_.padEnd(`${dateSource}:`, 15)} ${chalk.cyan(date)}`, isDiff ? `${chalk.red('✘')} (${chalk.yellow(diffHuman)})` : chalk.green('✔'));
        });

        if (!fix || isOk && !force) {
            return isOk;
        }
        
        if (referenceDate) {
            if (diffToReferenceDate.asSeconds() !== 0 || force) {
                console.log(`  ${chalk.green('Update exif date from external file...')}`);
                await setExifDate(filePath, referenceDate);
            }
        }
        const unixDate = exifDateToUse.unix();
        console.log(`  ${chalk.green('Fixing unix timestamps...')}`);
        await utimes(filePath, unixDate, unixDate);
        return true;
    }
    catch (err) {
        console.log(chalk.underline.bold(filePath));
        console.log(`${chalk.red(err.stack)}`);
    }
}

async function checkDiff(dirPath, { fix = false, dateFrom = undefined, force = false }) {
    console.log(`${fix ? 'Checking and fixing' : 'Checking'} dates on files in '${dirPath}'...`);
    let referenceDate = undefined;
    if (dateFrom) {
        referenceDate = await getExifDate(dateFrom);
        console.log(`- Using date from file ${dateFrom}: ${referenceDate}`);
    }
    const items = await getFileItems(dirPath);
    const files = items.filter(item => {
        return item.stats.isFile();
    });
    let numOk = 0;
    for (const file of files) {
        const ok = await checkDate(file, { fix, referenceDate, force });
        if (ok) {
            ++numOk;
        }
    }
    console.log(`Done! ${numOk} / ${files.length} is ok.`);
}

async function printExif(item) {
    const { path: filePath, stats, type } = item;
    console.log(`Print exif for ${filePath} with mime type ${type}...`);
    if (true || type !== 'image/jpeg') {
        console.log('run exiftool-vendored on', filePath);
        try {
            const tags = await exiftool.read(filePath);
            // prettyjson.render(tags);
            console.log(tags);
            console.log('date:', tags.DateTimeOriginal);
            return true;
        }
        catch (err) {
            console.error('Error:', err);
            return false;
        }
    }
    return getJpegExifData(filePath)
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

async function printInfo(dirPath) {
    console.log(`Print info on file(s) in '${dirPath}'...`);
    const items = await getFileItems(dirPath);
    const files = items.filter(item => {
        // return item.type === 'image/jpeg';
        return item.stats.isFile();
    });
    let numOk = 0;
    for (const file of files) {
        const ok = await printExif(file);
        if (ok) {
            ++numOk;
        }
    }
    console.log(`Done! ${numOk} / ${files.length} is ok.`);
}

program
    .name(name)
    .description(description)
    .version(version);

program
    .command('print-exif <path>')
    .description('Print exif data for all files matching the path')
    .action((path) => {
        console.log(`Print exif info for ${path}...`);
    });
    
program
    .command('check <path>')
    .description('Check exif vs file timestamps for all files matching the path')
    .option('--fix', 'Change file timestamp to the exif date. If using --date-from, update also exif.')
    .option('--force', 'Force fix')
    .option('--date-from <file>', 'Use exif date from another file.')
    .action(async (path, cmd) => {
        // console.log(`Check ${path}...${cmd.fix ? ' and fix dates' : ''}${cmd.dateFrom ? ` using date from ${cmd.dateFrom}` : ''}`);
        await checkDiff(path, cmd);
        process.exit(0);
    });

program.parse(process.argv);

if (!process.argv.slice(2).length) {
    program.outputHelp();
}
