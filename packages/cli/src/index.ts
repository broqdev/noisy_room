#!/usr/bin/env node
import { Command } from "commander";

const program = new Command();

program
  .name("noisy-room")
  .description("CLI tools for the Noisy Room workspace")
  .version("0.0.0")
  .showHelpAfterError();

program
  .command("hello")
  .description("Print a friendly greeting")
  .argument("[name]", "name to greet", "world")
  .option("-s, --shout", "uppercase the greeting")
  .action((name: string, options: { shout?: boolean }) => {
    const message = `Hello, ${name}!`;
    console.log(options.shout ? message.toUpperCase() : message);
  });

if (process.argv.length <= 2) {
  program.outputHelp();
} else {
  program.parse();
}

