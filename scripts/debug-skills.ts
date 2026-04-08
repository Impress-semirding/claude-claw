import { realpathSync } from 'fs';
import { relative, isAbsolute } from 'path';

const userDir = `/Users/dingxue/Documents/claude/claw/data/skills/8d48ec6e-810f-4c97-b179-c41bd0836db2`;
const skillDir = `${userDir}/find-skills`;

function validateSkillPath(skillsRoot: string, skillDir: string): boolean {
  try {
    const realSkillsRoot = realpathSync(skillsRoot);
    const realSkillDir = realpathSync(skillDir);
    const rel = relative(realSkillsRoot, realSkillDir);
    console.log('inside fn - realSkillsRoot:', realSkillsRoot);
    console.log('inside fn - realSkillDir:', realSkillDir);
    console.log('inside fn - relative:', rel);
    console.log('inside fn - startsWith(..):', rel.startsWith('..'));
    console.log('inside fn - isAbsolute:', isAbsolute(rel));
    return !rel.startsWith('..') && !isAbsolute(rel);
  } catch (e) {
    console.log('inside fn - ERROR:', e);
    return false;
  }
}

console.log('result:', validateSkillPath(userDir, skillDir));
