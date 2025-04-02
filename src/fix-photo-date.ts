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
import { FileItem, ExifData, CheckDateOptions, CheckDiffOptions } from './types';

async function stat(path: string): Promise<fs.Stats> {
    return new Promise((resolve, reject) => {
        fs.stat(path, (err: NodeJS.ErrnoException | null, stats: fs.Stats) => {
            if (err) {
                return reject(err);
            }
            return resolve(stats);
        });
    });
}

async function utimes(path: string, atime: Date, mtime: Date): Promise<boolean> {
    return new Promise((resolve, reject) => {
        fs.utimes(path, atime, mtime, (err: NodeJS.ErrnoException | null) => {
            if (err) {
                return reject(err);
            }
            return resolve(true);
        });
    });
}

async function getFileItems(glob: string): Promise<FileItem[]> {
    const paths = await globby(glob);
    const stats = await Promise.all(paths.map(path => stat(path)));
    const files = paths.map((path, i) => ({
        path,
        stats: stats[i],
        type: mime.lookup(path) || null,
    })) as FileItem[];
    return files;
}

export function getJpegExifData(filePath: string): Promise<ExifData> {
    return new Promise((resolve, reject) => {
        new ExifImage({ image: filePath }, (error: Error | null, exifData: ExifData) => {
            if (error) {
                return reject(error);
            }
            resolve(_.omit(exifData, 'exif.MakerNote') as ExifData);
        });
    });
}

function getJpegExifDateString(filePath: string): Promise<string> {
    return getJpegExifData(filePath).then(data => {
        return data.image.ModifyDate || '';
    });
}

export function parseJpegExifDate(dateString: string): moment.Moment {
    const date = moment(dateString, 'YYYY:MM:DD HH:mm:ss');
    if (!date.isValid()) {
        throw new Error(`Invalid date: ${dateString}. Required format: YYYY:MM:DD HH:mm:ss`);
    }
    return date;
}

async function getExifDate(filePath: string): Promise<moment.Moment> {
    try {
        const tags = await exiftool.read(filePath);
        const date = tags.DateTimeOriginal || tags.CreateDate;
        if (!date) {
            return moment(new Date());
        }
        return moment(date);
    } catch (err) {
        console.error('Exif tool read error:', err);
        throw err;
    }
}

async function setExifDate(filePath: string, date: moment.Moment, _outPath?: string): Promise<void> {
    try {
        let outPath = _outPath;
        if (_outPath) {
            const dirPath = resolve(_outPath, '../');
            const ext = extname(_outPath);
            const name = basename(_outPath, ext);
            let i = 0;
            while (outPath && existsSync(outPath)) {
                outPath = resolve(dirPath, `${name}-${++i}${ext}`);
            }
        }
        await exiftool.write(filePath, {
            AllDates: date.toISOString(),
        }, outPath ? [`-o`, `${outPath}`] : []);
    } catch (err) {
        console.error('Exif tool write error:', err);
        throw err;
    }
}

export async function checkDate(fileItem: FileItem, options: CheckDiffOptions): Promise<boolean> {
    const { path: filePath, stats } = fileItem;
    const { fix = false, referenceDate, force = false, outfile } = options;

    console.log(filePath);
    const exifData = await exiftool.read(filePath);
    const exifDateToUse = referenceDate || moment(exifData.DateTimeOriginal || exifData.CreateDate);
    console.log(`    Exif:           ${exifDateToUse.format()}`);

    const dates = [
        { name: 'atime', value: moment(stats.atime) },
        { name: 'mtime', value: moment(stats.mtime) },
        { name: 'ctime', value: moment(stats.ctime) },
        { name: 'birthtime', value: moment(stats.birthtime) }
    ];

    let allMatch = true;
    dates.forEach(({ name, value }) => {
        const diff = value.diff(exifDateToUse, 'minutes');
        const match = diff === 0 || force;
        if (!match) allMatch = false;
        console.log(`    ${name.padEnd(14)}${value.format()} ${match ? '✔' : '✘'} ${diff !== 0 ? `(${diff > 0 ? '+' : '-'}${moment.duration(Math.abs(diff), 'minutes').humanize()})` : ''}`);
    });

    if ((!allMatch || referenceDate) && fix) {
        await exiftool.write(filePath, {
            AllDates: exifDateToUse.format('YYYY:MM:DD HH:mm:ss')
        });
        if (outfile) {
            await fs.promises.rename(filePath, outfile);
        }
    }

    return allMatch || fix;
}

export function getDateFromFileName(fileName: string, format: string): moment.Moment | undefined {
    const fileNameDate = moment(fileName, format);
    if (fileName.includes(fileNameDate.format(format))) {
        return fileNameDate;
    }
    return undefined;
}

export async function checkDiff(dirPath: string, options: CheckDiffOptions): Promise<void> {
    const { fix = false, dateFrom, force = false, dateFromName = false, dateFormat = 'YYYY-MM-DD HHmmss', outPath, outFormat = false } = options;

    console.log(`${fix ? 'Checking and fixing' : 'Checking'} dates on files in '${dirPath}'...`);
    let referenceDate: moment.Moment | undefined;

    if (dateFrom) {
        const tags = await exiftool.read(dateFrom);
        referenceDate = moment(tags.DateTimeOriginal || tags.CreateDate);
        console.log(`- Using date from file ${dateFrom}: ${referenceDate.format()}`);
    }

    const items = await getFileItems(dirPath);
    const files = items.filter(item => {
        return item.stats.isFile() && !/@eaDir/.test(item.path);
    });

    let numOk = 0;
    for (const file of files) {
        let _referenceDate: moment.Moment | undefined;
        const name = basename(file.path);
        let outname = name;

        if (!referenceDate && dateFromName) {
            _referenceDate = getDateFromFileName(name, dateFormat);
        } else {
            _referenceDate = referenceDate;
        }

        if (_referenceDate && outFormat) {
            outname = _referenceDate.format(outFormat) + extname(name);
        }

        let outfile: string | undefined;
        if (typeof outPath === 'string') {
            outfile = resolve(dirPath, outPath, outname);
        } else {
            outfile = resolve(file.path, '../../out/', outname);
        }

        const ok = await checkDate(file, { fix, referenceDate: _referenceDate, force, outfile });

        if (_referenceDate && ok) {
            const orgDir = resolve(dirPath, `../${basename(dirPath)}-origin`);
            const originPath = resolve(orgDir, relative(dirPath, file.path));
            await bakOriginFile(file.path, originPath);
        }

        if (ok) {
            ++numOk;
        }
    }

    console.log(`Done! ${numOk} / ${files.length} is ok.`);
}

async function bakOriginFile(oldPath: string, newPath: string): Promise<void> {
    const dirPath = dirname(newPath);
    if (!existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
    fs.renameSync(oldPath, newPath);
} 