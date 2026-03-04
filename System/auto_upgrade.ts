/**
 * auto_upgrade.ts — Capability Intelligence Pipeline
 *
 * Scans Skills/global/ for registered skills, compares against
 * Memory/skills_registry.md, and outputs a diff report.
 *
 * This is the framework for PRD Section 10's self-improvement engine.
 * Full A/B testing requires NanoClaw integration (future).
 *
 * Usage:
 *   npx ts-node System/auto_upgrade.ts
 */

import fs from "fs";
import path from "path";

const ROOT_DIR = path.resolve(__dirname, "..");
const SKILLS_DIR = path.join(ROOT_DIR, "Skills", "global");
const REGISTRY_PATH = path.join(ROOT_DIR, "Memory", "skills_registry.md");
const MONITORING_DIR = path.join(ROOT_DIR, "Monitoring");

interface SkillInfo {
    name: string;
    description: string;
    connector?: string;
    hasScripts: boolean;
    hasChangelog: boolean;
}

interface RegistryEntry {
    name: string;
    status: string;
}

/**
 * Scan the Skills/global/ directory for installed skills.
 */
function scanSkills(): SkillInfo[] {
    const skills: SkillInfo[] = [];

    if (!fs.existsSync(SKILLS_DIR)) return skills;

    const dirs = fs.readdirSync(SKILLS_DIR, { withFileTypes: true });

    for (const dir of dirs) {
        if (!dir.isDirectory()) continue;

        const skillDir = path.join(SKILLS_DIR, dir.name);
        const skillMd = path.join(skillDir, "SKILL.md");
        const changelog = path.join(skillDir, "CHANGELOG.md");
        const scriptsDir = path.join(skillDir, "scripts");

        const skill: SkillInfo = {
            name: dir.name,
            description: "",
            hasScripts: fs.existsSync(scriptsDir),
            hasChangelog: fs.existsSync(changelog),
        };

        // Parse SKILL.md for metadata
        if (fs.existsSync(skillMd)) {
            const content = fs.readFileSync(skillMd, "utf-8");

            // Extract description from frontmatter
            const descMatch = content.match(/Description:\s*(.+)/i);
            if (descMatch) skill.description = descMatch[1].trim();

            // Extract connector
            const connMatch = content.match(/Target Connector:\s*(.+)/i);
            if (connMatch) skill.connector = connMatch[1].trim();
        }

        skills.push(skill);
    }

    return skills;
}

/**
 * Parse the skills_registry.md for known skills.
 */
function parseRegistry(): RegistryEntry[] {
    const entries: RegistryEntry[] = [];

    if (!fs.existsSync(REGISTRY_PATH)) return entries;

    const content = fs.readFileSync(REGISTRY_PATH, "utf-8");
    const lines = content.split("\n");

    for (const line of lines) {
        // Match lines like "- **skill-name**: description" or "- skill-name (ACTIVE)"
        const match = line.match(/^[-*]\s+\*?\*?(\S+)\*?\*?\s*[:(]/);
        if (match) {
            const name = match[1].replace(/[*:]/g, "");
            const statusMatch = line.match(/\((ACTIVE|DEPRECATED|TESTING)\)/i);
            entries.push({
                name,
                status: statusMatch ? statusMatch[1].toUpperCase() : "UNKNOWN",
            });
        }
    }

    return entries;
}

/**
 * Compare installed skills against registry.
 */
function compareSkills(
    installed: SkillInfo[],
    registry: RegistryEntry[]
): { newSkills: SkillInfo[]; overlap: SkillInfo[]; registered: RegistryEntry[] } {
    const registryNames = new Set(registry.map((r) => r.name));
    const installedNames = new Set(installed.map((s) => s.name));

    const newSkills = installed.filter((s) => !registryNames.has(s.name));
    const overlap = installed.filter((s) => registryNames.has(s.name));
    const registered = registry.filter((r) => !installedNames.has(r.name));

    return { newSkills, overlap, registered };
}

/**
 * Generate the upgrade report as Markdown.
 */
function generateReport(
    installed: SkillInfo[],
    registry: RegistryEntry[],
    diff: ReturnType<typeof compareSkills>
): string {
    const timestamp = new Date().toISOString();

    let md = `# Capability Upgrade Report\n\n`;
    md += `> Generated: ${timestamp}\n\n`;

    // Summary
    md += `## Summary\n\n`;
    md += `| Metric | Count |\n`;
    md += `|---|---|\n`;
    md += `| Installed Skills | ${installed.length} |\n`;
    md += `| Registry Entries | ${registry.length} |\n`;
    md += `| **New** (not in registry) | ${diff.newSkills.length} |\n`;
    md += `| **Overlap** (in both) | ${diff.overlap.length} |\n`;
    md += `| **Registry-only** (missing from disk) | ${diff.registered.length} |\n\n`;

    // New Skills
    if (diff.newSkills.length > 0) {
        md += `## 🆕 New Skills (Not Registered)\n\n`;
        for (const s of diff.newSkills) {
            md += `### ${s.name}\n`;
            md += `- Description: ${s.description || "N/A"}\n`;
            md += `- Connector: ${s.connector || "N/A"}\n`;
            md += `- Scripts: ${s.hasScripts ? "✅" : "❌"}\n`;
            md += `- Changelog: ${s.hasChangelog ? "✅" : "❌"}\n\n`;
        }
    }

    // Overlap
    if (diff.overlap.length > 0) {
        md += `## 🔄 Existing Skills (In Registry)\n\n`;
        for (const s of diff.overlap) {
            const regEntry = registry.find((r) => r.name === s.name);
            md += `- **${s.name}** — Registry status: ${regEntry?.status || "UNKNOWN"}\n`;
        }
        md += `\n`;
    }

    // Missing from disk
    if (diff.registered.length > 0) {
        md += `## ⚠️ Registry-Only (Not Found on Disk)\n\n`;
        for (const r of diff.registered) {
            md += `- **${r.name}** — Status: ${r.status}\n`;
        }
        md += `\n`;
    }

    // Recommendations
    md += `## Recommendations\n\n`;
    if (diff.newSkills.length > 0) {
        md += `1. Register ${diff.newSkills.length} new skill(s) in \`Memory/skills_registry.md\`\n`;
    }
    if (diff.registered.length > 0) {
        md += `2. Investigate ${diff.registered.length} registry-only entry/entries — may need re-installation\n`;
    }
    if (diff.newSkills.length === 0 && diff.registered.length === 0) {
        md += `✅ All skills are in sync. No action required.\n`;
    }

    return md;
}

/**
 * Run the upgrade pipeline.
 */
export function runUpgrade(): string {
    console.log(`
╔══════════════════════════════════════════════════════╗
║       BOS Capability Intelligence Pipeline            ║
╚══════════════════════════════════════════════════════╝
`);

    // Scan
    const installed = scanSkills();
    console.log(`[auto_upgrade] Found ${installed.length} installed skill(s)`);

    // Parse registry
    const registry = parseRegistry();
    console.log(`[auto_upgrade] Found ${registry.length} registry entry/entries`);

    // Compare
    const diff = compareSkills(installed, registry);
    console.log(`[auto_upgrade] New: ${diff.newSkills.length}, Overlap: ${diff.overlap.length}, Registry-only: ${diff.registered.length}`);

    // Generate report
    const report = generateReport(installed, registry, diff);

    // Write to Monitoring
    if (!fs.existsSync(MONITORING_DIR)) {
        fs.mkdirSync(MONITORING_DIR, { recursive: true });
    }

    const reportPath = path.join(MONITORING_DIR, "upgrade_report.md");
    fs.writeFileSync(reportPath, report, "utf-8");
    console.log(`[auto_upgrade] Report written to: ${reportPath}`);

    return reportPath;
}

// Run if executed directly
if (require.main === module) {
    runUpgrade();
}
