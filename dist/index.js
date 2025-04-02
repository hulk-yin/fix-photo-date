import { Command } from 'commander';
import { checkDiff } from './fix-photo-date';
const program = new Command();
program
    .version('1.0.0')
    .description('Check if file and exif dates differs on photo or video files and optionally fix it.')
    .option('-f, --fix', 'Fix dates if they differ')
    .option('-d, --date-from <file>', 'Use date from specified file')
    .option('--force', 'Force update even if dates match')
    .option('--date-from-name', 'Use date from filename')
    .option('--date-format <format>', 'Date format for filename parsing', 'YYYY-MM-DD HHmmss')
    .option('-o, --out-path <path>', 'Output path for fixed files')
    .option('--out-format <format>', 'Output filename format')
    .argument('<dir>', 'Directory to check')
    .action(async (dir, options) => {
    try {
        await checkDiff(dir, options);
    }
    catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
});
program.parse(process.argv);
