# fix-photo-date
Check if file and exif dates differ on photos and optionally fix it.

## Install

    npm install

## Usage

    npm run [check|fix] [dir]

The program will extract the exif and file dates on all jpeg photos
in the dir and print a diff summary in the console. If `fix` is used,
the program will set the file's modification date to the exif date.
