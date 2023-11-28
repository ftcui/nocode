import Table from "../models/table";
import Field from "../models/field";
import Trigger from "../models/trigger";
import TableConstraint from "../models/table_constraints";

import View from "../models/view";
import db from "../db";
import mocks from "./mocks";
const { mockReqRes } = mocks;
const { getState } = require("../db/state");
import Page from "../models/page";
import type { PageCfg } from "@saltcorn/types/model-abstracts/abstract_page";
import { afterAll, beforeAll, describe, it, expect } from "@jest/globals";
import { assertIsSet } from "./assertions";
import {
  prepareQueryEnviroment,
  sendViewToServer,
  deleteViewFromServer,
  renderEditInEditConfig,
} from "./remote_query_helper";

let remoteQueries = false;

getState().registerPlugin("base", require("../base-plugin"));

afterAll(db.close);
beforeAll(async () => {
  await require("../db/reset_schema")();
  await require("../db/fixtures")();
});

const mkConfig = (hasSave?: boolean) => {
  return {
    layout: {
      above: [
        {
          widths: [2, 10],
          besides: [
            {
              above: [null, { type: "blank", contents: "Name", isFormula: {} }],
            },
            {
              above: [
                null,
                { type: "field", fieldview: "edit", field_name: "name" },
              ],
            },
          ],
        },
        { type: "line_break" },
        {
          widths: [2, 10],
          besides: [
            {
              above: [null, { type: "blank", contents: "Age", isFormula: {} }],
            },
            {
              above: [
                null,
                { type: "field", fieldview: "edit", field_name: "age" },
              ],
            },
          ],
        },
        { type: "line_break" },

        ...(hasSave
          ? [
              {
                type: "action",
                rndid: "74310f",
                minRole: 100,
                isFormula: {},
                action_name: "Save",
                action_style: "btn-primary",
                configuration: {},
              },
            ]
          : []),
      ],
    },
    columns: [
      { type: "Field", fieldview: "edit", field_name: "name" },
      { type: "Field", fieldview: "edit", field_name: "age" },
      ...(hasSave
        ? [
            {
              type: "Action",
              rndid: "74310f",
              minRole: 100,
              isFormula: {},
              action_name: "Save",
              action_style: "btn-primary",
              configuration: {},
            },
          ]
        : []),
    ],
  };
};

describe("Edit view with constraints and validations", () => {
  it("should setup", async () => {
    const persons = await Table.create("ValidatedTable1");
    await Field.create({
      table: persons,
      name: "name",
      type: "String",
    });
    await Field.create({
      table: persons,
      name: "age",
      type: "Integer",
    });
    await TableConstraint.create({
      table_id: persons.id,
      type: "Formula",
      configuration: {
        formula: "age>12",
        errormsg: "Must be at least a teenager",
      },
    });
    await Trigger.create({
      action: "run_js_code",
      table_id: persons.id,
      when_trigger: "Validate",
      configuration: {
        code: `
        if(age && age<16) return {error: "Must be 16+ to qualify"}
        if(!row.name) return {set_fields: {name: "PersonAged"+age}}
      `,
      },
    });
    await View.create({
      name: "ValidatedWithSave",
      table_id: persons.id,
      viewtemplate: "Edit",
      min_role: 100,
      configuration: mkConfig(true),
    });
    await View.create({
      name: "ValidatedAutoSave",
      table_id: persons.id,
      viewtemplate: "Edit",
      min_role: 100,
      configuration: { ...mkConfig(false), auto_save: true },
    });
    await View.create({
      name: "ValidatedShow",
      table_id: persons.id,
      viewtemplate: "Show",
      min_role: 100,
      configuration: {},
    });
  });
  it("should return error on save constrain violation", async () => {
    const v = await View.findOne({ name: "ValidatedWithSave" });
    assertIsSet(v);
    mockReqRes.reset();
    await v.runPost({}, { name: "Fred", age: 10 }, mockReqRes);
    const res = mockReqRes.getStored();
    expect(res.flash).toStrictEqual(["error", "Must be at least a teenager"]);
    expect(res.sendWrap[1]).toContain("<form");
    expect(res.sendWrap[1]).toContain('value="Fred"');
    //console.log(res);
    expect(
      await Table.findOne("ValidatedTable1")!.countRows({ name: "Fred" })
    ).toBe(0);
  });
  it("should return error on save validate violation", async () => {
    const v = await View.findOne({ name: "ValidatedWithSave" });
    assertIsSet(v);
    mockReqRes.reset();
    await v.runPost({}, { name: "Fred", age: 14 }, mockReqRes);
    const res = mockReqRes.getStored();
    expect(res.flash).toStrictEqual(["error", "Must be 16+ to qualify"]);
    expect(res.sendWrap[1]).toContain("<form");
    expect(res.sendWrap[1]).toContain('value="Fred"');
    expect(
      await Table.findOne("ValidatedTable1")!.countRows({ name: "Fred" })
    ).toBe(0);
    //console.log(res);
  });
  it("should return save normally", async () => {
    const v = await View.findOne({ name: "ValidatedWithSave" });
    assertIsSet(v);
    mockReqRes.reset();
    v.configuration.view_when_done = "ValidatedShow";
    await v.runPost({}, { name: "Fred", age: 18 }, mockReqRes);
    const res = mockReqRes.getStored();

    expect(!!res.flash).toBe(false);
    expect(res.url).toBe("/view/ValidatedShow?id=1");

    expect(
      await Table.findOne("ValidatedTable1")!.countRows({ name: "Fred" })
    ).toBe(1);
  });
  it("should update normally", async () => {
    const v = await View.findOne({ name: "ValidatedWithSave" });
    assertIsSet(v);
    mockReqRes.reset();
    await v.runPost({}, { id: 1, name: "Fred", age: 19 }, mockReqRes);
    const res = mockReqRes.getStored();

    expect(!!res.flash).toBe(false);
    expect(res.url).toBe("/");
    const row = await Table.findOne("ValidatedTable1")!.getRow({
      name: "Fred",
    });
    assertIsSet(row);
    expect(row.age).toBe(19);
  });
  it("should not update to violate constraint", async () => {
    const v = await View.findOne({ name: "ValidatedWithSave" });
    assertIsSet(v);
    mockReqRes.reset();
    await v.runPost({}, { id: 1, name: "Fred", age: 10 }, mockReqRes);
    const res = mockReqRes.getStored();
    expect(res.flash).toStrictEqual(["error", "Must be at least a teenager"]);
    expect(res.sendWrap[1]).toContain("<form");
    expect(res.sendWrap[1]).toContain('value="Fred"');

    const row = await Table.findOne("ValidatedTable1")!.getRow({
      name: "Fred",
    });
    assertIsSet(row);
    expect(row.age).toBe(19);
  });
  it("should not update to violate constraint", async () => {
    const v = await View.findOne({ name: "ValidatedWithSave" });
    assertIsSet(v);
    mockReqRes.reset();
    await v.runPost({}, { id: 1, name: "Fred", age: 14 }, mockReqRes);
    const res = mockReqRes.getStored();
    expect(res.flash).toStrictEqual(["error", "Must be 16+ to qualify"]);
    expect(res.sendWrap[1]).toContain("<form");
    expect(res.sendWrap[1]).toContain('value="Fred"');

    const row = await Table.findOne("ValidatedTable1")!.getRow({
      name: "Fred",
    });
    assertIsSet(row);
    expect(row.age).toBe(19);
  });
  it("should return error on autosave constrain violation", async () => {
    const v = await View.findOne({ name: "ValidatedAutoSave" });
    assertIsSet(v);
    mockReqRes.reset();
    mockReqRes.req.xhr = true;
    await v.runPost({}, { name: "Alex", age: 10 }, mockReqRes);
    const res = mockReqRes.getStored();
    expect(res.status).toBe(422);
    expect(res.json.error).toBe("Must be at least a teenager");

    expect(
      await Table.findOne("ValidatedTable1")!.countRows({ name: "Alex" })
    ).toBe(0);
    mockReqRes.reset();
  });
  it("should return error on autosave validate violation", async () => {
    const v = await View.findOne({ name: "ValidatedAutoSave" });
    assertIsSet(v);
    mockReqRes.reset();
    mockReqRes.req.xhr = true;
    await v.runPost({}, { name: "Alex", age: 14 }, mockReqRes);
    const res = mockReqRes.getStored();
    expect(res.status).toBe(422);
    expect(res.json.error).toBe("Must be 16+ to qualify");

    expect(
      await Table.findOne("ValidatedTable1")!.countRows({ name: "Alex" })
    ).toBe(0);
    mockReqRes.reset();
  });
  it("should autosave normally", async () => {
    const v = await View.findOne({ name: "ValidatedAutoSave" });
    assertIsSet(v);
    mockReqRes.reset();
    mockReqRes.req.xhr = true;
    await v.runPost({}, { name: "Alex", age: 18 }, mockReqRes);
    const res = mockReqRes.getStored();

    expect(res.json).toStrictEqual({
      view_when_done: undefined,
      url_when_done: "/",
      id: 2,
    });
    //expect(res.json.error).toBe("Must be 16+ to qualify");

    expect(
      await Table.findOne("ValidatedTable1")!.countRows({ name: "Alex" })
    ).toBe(1);
    mockReqRes.reset();
  });
  it("should update autosave normally", async () => {
    const v = await View.findOne({ name: "ValidatedAutoSave" });
    assertIsSet(v);
    v.configuration.view_when_done = "ValidatedShow";

    mockReqRes.reset();
    mockReqRes.req.xhr = true;
    await v.runPost({}, { id: 1, name: "Fred", age: 20 }, mockReqRes);
    const res = mockReqRes.getStored();

    expect(res.json).toStrictEqual({
      view_when_done: "ValidatedShow",
      url_when_done: "/view/ValidatedShow?id=1",
    });
    //expect(res.json.error).toBe("Must be 16+ to qualify");

    const row = await Table.findOne("ValidatedTable1")!.getRow({
      name: "Fred",
    });
    assertIsSet(row);
    expect(row.age).toBe(20);
    mockReqRes.reset();
  });
  it("should not change existing on validation ", async () => {
    const v = await View.findOne({ name: "ValidatedAutoSave" });
    assertIsSet(v);
    v.configuration.view_when_done = "ValidatedShow";
    //remove name column.
    v.configuration.columns = v.configuration.columns.filter(
      (c: any) => c.field_name !== "name"
    );
    mockReqRes.reset();
    mockReqRes.req.xhr = true;
    await v.runPost({}, { id: 1, age: 41 }, mockReqRes);
    const res = mockReqRes.getStored();

    expect(res.json).toStrictEqual({
      view_when_done: "ValidatedShow",
      url_when_done: "/view/ValidatedShow?id=1",
    });
    //expect(res.json.error).toBe("Must be 16+ to qualify");

    const row = await Table.findOne("ValidatedTable1")!.getRow({
      id: 1,
    });
    assertIsSet(row);
    expect(row.age).toBe(41);
    expect(row.name).toBe("Fred");
    mockReqRes.reset();
  });
});
describe("Edit-in-edit", () => {
  it("should setup", async () => {
    await View.create({
      name: "EditPublisherWithBooks",
      table_id: Table.findOne("publisher")?.id,
      viewtemplate: "Edit",
      min_role: 100,
      configuration: {
        layout: {
          above: [
            {
              gx: null,
              gy: null,
              style: {
                "margin-bottom": "1.5rem",
              },
              aligns: ["end", "start"],
              widths: [2, 10],
              besides: [
                {
                  above: [
                    null,
                    {
                      font: "",
                      type: "blank",
                      block: false,
                      style: {},
                      inline: false,
                      contents: "Name",
                      labelFor: "name",
                      isFormula: {},
                      textStyle: "",
                    },
                  ],
                },
                {
                  above: [
                    null,
                    {
                      type: "field",
                      block: false,
                      fieldview: "edit",
                      textStyle: "",
                      field_name: "name",
                      configuration: {},
                    },
                  ],
                },
              ],
              breakpoints: ["", ""],
            },
            {
              name: "6dfcdb",
              type: "view",
              view: "ChildList:authoredit.books.publisher",
              state: "shared",
            },
            {
              type: "action",
              block: false,
              rndid: "dbf003",
              minRole: 100,
              isFormula: {},
              action_icon: "",
              action_name: "Save",
              action_size: "",
              action_bgcol: "",
              action_label: "",
              action_style: "btn-primary",
              configuration: {},
              action_textcol: "",
              action_bordercol: "",
            },
          ],
        },
        columns: [
          {
            type: "Field",
            block: false,
            fieldview: "edit",
            textStyle: "",
            field_name: "name",
            configuration: {},
          },
          {
            type: "Action",
            rndid: "dbf003",
            minRole: 100,
            isFormula: {},
            action_icon: "",
            action_name: "Save",
            action_size: "",
            action_bgcol: "",
            action_label: "",
            action_style: "btn-primary",
            configuration: {},
            action_textcol: "",
            action_bordercol: "",
          },
        ],
        viewname: "EditPublisherWithBooks",
        auto_save: false,
        split_paste: false,
        exttable_name: null,
        page_when_done: null,
        view_when_done: "author_multi_edit",
        dest_url_formula: null,
        destination_type: "View",
        formula_destinations: [],
      },
    });
  });
  it("should run get", async () => {
    const v = await View.findOne({ name: "EditPublisherWithBooks" });
    assertIsSet(v);
    const vres0 = await v.run({}, mockReqRes);
    expect(vres0).toContain("<form");
    expect(vres0).toContain("add_repeater('publisher')");
    const vres1 = await v.run({ id: 1 }, mockReqRes);
    expect(vres1).toContain("<form");
    expect(vres1).toContain("add_repeater('publisher')");
    expect(vres1).toContain("Leo Tolstoy");
    expect(vres1).not.toContain("Melville");
  });
  it("should run post", async () => {
    const v = await View.findOne({ name: "EditPublisherWithBooks" });
    const books = Table.findOne("books");
    assertIsSet(books);
    assertIsSet(v);
    await v.runPost(
      {},
      {
        name: "newpub",
        author_0: "newpubsnewbook",
        author_1: "newpubsotherbook",
      },
      mockReqRes
    );
    const pubrow = await Table.findOne("publisher")?.getRow({ name: "newpub" });
    assertIsSet(pubrow);
    const bookrow = await books.getRow({
      author: "newpubsnewbook",
    });
    assertIsSet(bookrow);
    expect(bookrow.publisher).toBe(pubrow.id);
    expect(bookrow.pages).toBe(678);
    const nbooks1 = await books.countRows({ publisher: pubrow.id });
    expect(nbooks1).toBe(2);
    await v.runPost(
      {},
      {
        id: pubrow.id,
        name: "newpub",
        author_0: "newpubsnewbook",
        id_0: bookrow.id,
      },
      mockReqRes
    );
    const nbooks2 = await books.countRows({ publisher: pubrow.id });
    expect(nbooks2).toBe(1);
  });
});
