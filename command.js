import program from 'commander';
import { name, version, description} from './package.json';
import {checkDiff,printInfo} from './fix-photo-date';
program
.name(name)
.description(description)
.version(version);
 

program
.command('print-exif <path>')
.description('Print exif data for all files matching the path')
.action(async (path) => {
   await printInfo(path)
    console.log(`Print exif info for ${path}...`);
    process.exit(0)
});

program
.command('check <path>')
.description('Check exif vs file timestamps for all files matching the path')
.option('--fix', 'Change file timestamp to the exif date. If using --date-from, update also exif.')
.option('--force', 'Force fix')
.option('--date-from-name', 'Use exif date from file name.If using --date-format.')
.option('--date-format','Date format in the filename, when using --date-form-name. ')
.option('--date-from', 'Use exif date from another file.')
.option('--out-path <dirpath>','Fix file output dir.')
.option('--out-format <format>','Fix file output name format.')
.action(async (path, cmd) => {
    // console.log(`Check ${path}...${cmd.fix ? ' and fix dates' : ''}${cmd.dateFrom ? ` using date from ${cmd.dateFrom}` : ''}`);
    await checkDiff(path, cmd);
    process.exit(0);
});

program.parse(process.argv);

if (!process.argv.slice(2).length) {
program.outputHelp();
}
