'use strict';

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
    const lines = input.split(/\r?\n/).filter(line => line.trim() !== '');
    if (!lines.length) {
        fail('CodeRabbit output did not contain a completion event.');
        return;
    }

    for (const line of lines) {
        try {
            const event = JSON.parse(line);
            if (event && event.type === 'error') {
                fail('CodeRabbit emitted an error event.');
                return;
            }
        } catch {
            // The final line is validated below; older clients may include non-event output.
        }
    }

    let completion;
    try {
        completion = JSON.parse(lines[lines.length - 1]);
    } catch {
        fail('The final CodeRabbit output line was not a valid JSON event.');
        return;
    }

    if (!completion || completion.type !== 'complete') {
        fail('CodeRabbit output did not end with a complete event.');
    } else if (completion.status === 'review_skipped') {
        fail('CodeRabbit skipped the review.');
    } else if (completion.outcome === 'failed') {
        fail('CodeRabbit reported that the review failed.');
    } else if (Number.isFinite(Number(completion.unreviewedFileCount))
        && Number(completion.unreviewedFileCount) > 0) {
        fail('CodeRabbit left one or more files unreviewed.');
    }
});

function fail(message) {
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
}
