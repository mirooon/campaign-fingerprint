/**
 * Lexical template of a registrable domain label, used as a "domain_pattern" pivot.
 *
 * Bulk-registered campaign domains are often generated from a template, e.g.
 * finance23-voluptas94.sbs, finance95-praesentium23.pro (CSIRT KNF 2026: the same
 * pattern moved from .pro to .sbs). We tokenise the label into letter runs, digit
 * runs and separators; digit runs become `<n>`, Lorem Ipsum words become `<lorem>`.
 * Two variants are produced: TLD-specific and TLD-agnostic (`.*`).
 *
 * Pure functions, no network access.
 */
import { parse as parseDomain } from "tldts";

// Classic "Lorem ipsum…", "Sed ut perspiciatis…", "At vero eos…" passages plus words
// used by common Lorem Ipsum generators.
const LOREM_LIST = `
lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et
dolore magna aliqua enim ad minim veniam quis nostrud exercitation ullamco laboris nisi aliquip ex ea
commodo consequat duis aute irure in reprehenderit voluptate velit esse cillum eu fugiat nulla pariatur
excepteur sint occaecat cupidatat non proident sunt culpa qui officia deserunt mollit anim id est laborum
perspiciatis unde omnis iste natus error voluptatem accusantium doloremque laudantium totam rem aperiam
eaque ipsa quae ab illo inventore veritatis quasi architecto beatae vitae dicta explicabo nemo ipsam quia
voluptas aspernatur aut odit fugit consequuntur magni dolores eos ratione sequi nesciunt neque porro
quisquam dolorem adipisci numquam eius modi tempora incidunt magnam aliquam quaerat minima nostrum
exercitationem ullam corporis suscipit laboriosam aliquid commodi consequatur autem vel eum iure quam
nihil molestiae illum quo vero accusamus iusto odio dignissimos ducimus blanditiis praesentium voluptatum
deleniti atque corrupti quos quas molestias excepturi occaecati cupiditate provident similique mollitia
animi dolorum fuga harum quidem rerum facilis expedita distinctio nam libero tempore cum soluta nobis
eligendi optio cumque impedit quod maxime placeat facere possimus assumenda repellendus temporibus
quibusdam officiis debitis necessitatibus saepe eveniet voluptates repudiandae recusandae itaque earum hic
tenetur sapiente delectus reiciendis voluptatibus maiores alias perferendis doloribus asperiores repellat
accumsan aenean aliquet ante arcu auctor augue bibendum blandit condimentum congue convallis cras curabitur
cursus dapibus diam dictum dictumst dignissim donec efficitur egestas eget eleifend elementum eros etiam
facilisis fames faucibus felis fermentum feugiat finibus fringilla fusce gravida habitant habitasse
hendrerit iaculis imperdiet integer interdum justo lacinia lacus laoreet lectus ligula lobortis luctus
maecenas malesuada massa mattis mauris metus molestie morbi nec netus nibh nisl nunc orci ornare
pellentesque pharetra phasellus porta porttitor posuere potenti praesent pretium proin pulvinar purus
quisque rhoncus risus rutrum sagittis sapien scelerisque semper senectus sodales sollicitudin suspendisse
tellus tempus tincidunt tortor tristique turpis ullamcorper ultrices ultricies urna varius vehicula
vestibulum viverra volutpat vulputate
`;

export const LOREM_WORDS: ReadonlySet<string> = new Set(LOREM_LIST.split(/\s+/).filter(Boolean));

export interface DomainTemplate {
  /** TLD-specific template, e.g. "finance<n>-<lorem><n>.sbs". */
  specific: string;
  /** TLD-agnostic template, e.g. "finance<n>-<lorem><n>.*". */
  agnostic: string;
  /** Registrable label without the public suffix, e.g. "finance23-voluptas94". */
  label: string;
  /** Public suffix, e.g. "sbs" or "com.pl". */
  suffix: string;
  /** Number of <n>/<lorem> placeholders. */
  placeholders: number;
  /** Number of literal letters kept in the template (anchor strength). */
  literalChars: number;
}

export interface DomainTemplateOptions {
  /** Minimum length of a Lorem Ipsum word to be replaced by <lorem>. Default 4. */
  minLoremLength?: number;
}

/**
 * Builds the lexical template of a registrable domain (or of the registrable part of a
 * hostname). Returns null for IPs, inputs without a registrable label, punycode labels
 * and templates without any placeholder.
 */
export function domainTemplate(registrableDomain: string, opts: DomainTemplateOptions = {}): DomainTemplate | null {
  const minLorem = opts.minLoremLength ?? 4;
  const input = (registrableDomain ?? "").trim().toLowerCase().replace(/\.$/, "");
  if (!input) return null;
  const parsed = parseDomain(input, { allowPrivateDomains: true });
  if (parsed.isIp || !parsed.domain || !parsed.publicSuffix) return null;
  const label = parsed.domainWithoutSuffix ?? parsed.domain.slice(0, -(parsed.publicSuffix.length + 1));
  if (!label || label.includes("xn--")) return null;

  let template = "";
  let placeholders = 0;
  let literalChars = 0;
  for (const run of label.match(/[a-z]+|[0-9]+|[^a-z0-9]+/g) ?? []) {
    if (/^[0-9]+$/.test(run)) {
      template += "<n>";
      placeholders++;
    } else if (/^[a-z]+$/.test(run) && run.length >= minLorem && LOREM_WORDS.has(run)) {
      template += "<lorem>";
      placeholders++;
    } else {
      template += run;
      if (/^[a-z]+$/.test(run)) literalChars += run.length;
    }
  }
  if (placeholders === 0) return null;
  return {
    specific: `${template}.${parsed.publicSuffix}`,
    agnostic: `${template}.*`,
    label,
    suffix: parsed.publicSuffix,
    placeholders,
    literalChars,
  };
}
