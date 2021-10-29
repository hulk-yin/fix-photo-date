import fs, { existsSync } from 'fs';
import globby from 'globby';
import moment from 'moment';
import chalk from 'chalk';
import _ from 'lodash';
import mime from 'mime-types';
import { ExifImage } from 'exif';
import prettyjson from 'prettyjson';
import { exiftool } from 'exiftool-vendored';
import { basename, dirname, extname, relative, resolve } from 'path';

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
            // console.log(`Warning: ${filePath} has no original date time, using creation date.`);
            return moment(tags.CreateDate?.toISOString());
        }
        return moment(date.toISOString());
    } catch (err) {
        console.error('Exif tool read error:', err);
        throw err;
    }
}

async function setExifDate(filePath, date, _outPath) {
    try {
        let outPath = _outPath;
        if (_outPath) {
            const dirPath = resolve(_outPath, '../');
            const ext = extname(_outPath);
            const name = basename(_outPath,ext);
            let i = 0;
            while (existsSync(outPath)) {
                outPath = resolve(dirPath, `${name}-${++i}${ext}`)
            }
        }
        const tags = await exiftool.write(filePath, {
            AllDates: date.toISOString(),
        }, outPath ? [`-o`, `${outPath}`] : []);
    } catch (err) {
        console.error('Exif tool write error:', err);
        throw err;
    }
}

async function checkDate(item, { fix = false, referenceDate = undefined, force = false, outfile = undefined }) {
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
        console.log(`${chalk.underline.gray(filePath)}`);
        console.log(`  ${_.padEnd(referenceDate ? 'Exif (external):' : 'Exif:', 15)} ${chalk.magenta(exifDateToUse)}`);
        let isOk = false;
        datesToCompare.forEach(([dateSource, date]) => {
            const diff = moment.duration(date.diff(exifDateToUse));
            const diffSeconds = diff.asSeconds();
            const isDiff = diffSeconds !== 0;
            if (dateSource === 'mtime') {
                isOk = !isDiff;
            }
            const diffHuman = `${diff < 0 ? '-' : ''}${diff.humanize()}`;
            // console.log(`  ${_.padEnd(`${dateSource}:`, 15)} ${chalk.cyan(date)}`, isDiff ? `${chalk.red('✘')} (${chalk.yellow(diffHuman)})` : chalk.green('✔'));
        });
        if (!fix || isOk && !force) {
            return isOk;
        }
        if (referenceDate) {
            if (diffToReferenceDate.asSeconds() !== 0 || force) {
                console.log(`${chalk.green('Update exif date from external file...')}`);
                await setExifDate(filePath, referenceDate, outfile);
            }
        }
        // const unixDate = exifDateToUse.unix();
        // console.log(`  ${chalk.green('Fixing unix timestamps...')}`);
        // await utimes(filePath, unixDate, unixDate);
        return true;
    }
    catch (err) {
        console.log(chalk.underline.bold(filePath));
        console.log(`${chalk.red(err.stack)}`);
    }
}

function getDateFromFileName(fileName, format) {
    const fileNameDate = moment(fileName, format);
    if (fileName.includes(fileNameDate.format(format))) {
        return fileNameDate;
    }
}
export async function checkDiff(dirPath, { fix = false, dateFrom = undefined, force = false, dateFromName = false, dateFormat = 'YYYY-MM-DD HHmmss', outPath = undefined, outFormat = false }) {
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
        let _referenceDate
        const name = basename(file.path)
        let outname = name;
        if (!referenceDate && dateFromName) {
            _referenceDate = getDateFromFileName(name, dateFormat)


        } else {
            _referenceDate = referenceDate
        }
        if (_referenceDate && outFormat) {
            outname = _referenceDate.format(outFormat) + extname(name);
        }
        let outfile;
        if (typeof outPath == 'string') {
            outfile = resolve(dirPath, outPath, outname)
        } else {
            outfile = resolve(file.path, '../../out/', outname);
        }

        const ok = await checkDate(file, { fix, referenceDate: _referenceDate, force, outfile });
        if(_referenceDate && ok){
            const orgDir = resolve(dirPath,`../${basename(dirPath)}-origin`)
            const originPath = resolve(orgDir,relative(dirPath,file.path))
           await bakOriginFile(file.path,originPath);
        }
        if (ok) {
            ++numOk;
        }
    }
    console.log(`Done! ${numOk} / ${files.length} is ok.`);
}
async function bakOriginFile(oldPath,newPath,baseDir){
    const dirPath = dirname(newPath);
    if(!existsSync(dirPath)){
        fs.mkdirSync(dirPath,{recursive:true});
    }
    fs.renameSync(oldPath,newPath)
}
async function printExif(item) {
    const { path: filePath, stats, type } = item;
    console.log(`Print exif for ${filePath} with mime type ${type}...`);
    if (type !== 'image/jpeg') {
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
            return checkDate(item, {});
        })
        .catch(err => {
            console.error(err);
            return false;
        });
}

export async function printInfo(dirPath) {
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
    return;
}

