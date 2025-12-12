import * as path from 'path';
import * as fs from 'fs';

export async function traverseDirectory(directory: URL) {
  let subTree: string[] = [];

  const files = fs.readdirSync(directory.pathname, { withFileTypes: true });
  for (const file of files) {
    if (file.isDirectory()) {
      subTree.push(
        ...await traverseDirectory(new URL(path.join(directory.href, file.name)))
      );
    }
    else {
      const filePath = path.join(directory.pathname, file.name);
      subTree.push(filePath);
    }
  }

  return subTree;
}