import * as allure from "allure-js-commons";
import { Severity } from "allure-js-commons";

export async function setMeta(m: {
  displayName?: string; owner?: string;
  epic?: string; feature?: string; story?: string;
  severity?: keyof typeof Severity;
  parentSuite?: string; suite?: string; subSuite?: string;
  tags?: string[]; issue?: [id: string, name?: string]; tms?: [id: string, name?: string];
}) {
  if (m.displayName) await allure.displayName(m.displayName);
  if (m.owner) await allure.owner(m.owner);
  if (m.epic) await allure.epic(m.epic);
  if (m.feature) await allure.feature(m.feature);
  if (m.story) await allure.story(m.story);
  if (m.severity) await allure.severity(Severity[m.severity]);
  if (m.parentSuite) await allure.parentSuite(m.parentSuite);
  if (m.suite) await allure.suite(m.suite);
  if (m.subSuite) await allure.subSuite(m.subSuite);
  if (m.tags?.length) await allure.tags(...m.tags);
  if (m.issue) await allure.issue(m.issue[0], m.issue[1] || m.issue[0]);
  if (m.tms) await allure.tms(m.tms[0], m.tms[1] || m.tms[0]);
}