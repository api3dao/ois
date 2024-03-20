# `@api3/ois`

> OIS (or Oracle Integration Specifications) is a JSON object that describes an API specification

You can find the documentation for OIS in the [docs](https://docs.api3.org/reference/ois/latest/).

## Installation

To install this package run either:

`pnpm add @api3/ois`

or if you use npm:

`npm install @api3/ois --save`

### Gotchas

#### Use pinned version

We recommend using a pinned version of the OIS package because the validation included in the package enforces the OIS
version up to the patch. Pinning the version also ensures your project uses the correct OIS version even if there are
other packages depending on a different OIS version.

#### Make sure only one "zod" version is installed

Internally, we use [zod](https://github.com/colinhacks/zod) to implement validation and TS typing for the OIS schema.
It's possible to have TS issues when multiple different zod versions are used in a project.

## Usage

The OIS package defines validation and TypeScript typings that can be used to verify correctness of a full OIS schema or
just a part of it. For example:

```js
const { oisSchema } = require('@api3/ois');

const possibleOis = {
  // Placeholder values. Refer to the Example section below and the documentation.
  oisFormat: '1.0.0',
  version: '1.2.3',
  title: 'coinlayer',
  apiSpecifications: { ... } // omitted for brevity
  endpoints: [ ... ], // omitted for brevity
};
const result = oisSchema.safeParse(possibleOis);
if (!result.success) {
  throw result.error
} else {
  const validOis = result.data
}
```

### Example

An example of a valid OIS can be found [here](https://github.com/api3dao/ois/blob/main/test/fixtures/ois.json).

## Developer documentation

### Release

Releasing is facilitated by GitHub Actions using [changesets/action](https://github.com/changesets/action). To release a
new version follow these steps:

1. Assuming desired changes are present on `main` with changesets, create a GitHub PR to the `release` branch from
   `main`.
2. Merge the PR to `release` **using a merge commit**.
3. The [publish Action workflow](./.github/workflows/publish.yml) will create a release PR.
4. Review the release PR and merge it to `release` using **squash and merge**.
5. The [publish Action workflow](./.github/workflows/publish.yml) will publish a GitHub release and publish the package
   to npm with provenance. It will also create a PR for merging the `release` branch back to `main`.
6. Merge the PR to `main` from `release` **using a merge commit**.

Note that development can continue on `main` during the release process, or in other words, `main` does not need to be
protected.
