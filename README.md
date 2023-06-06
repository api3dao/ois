# `@api3/ois`

> OIS (or Oracle Integration Specifications) is a JSON object that describes an API specification

You can find the documentation for OIS in the [docs](https://docs.api3.org/reference/ois/latest/).

## Installation

To install this package run either:

`yarn add @api3/ois`

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

To release a new version follow these steps:

1. `git checkout main && git pull` - ensure you are on a "main" branch with latest changes
2. `yarn version` - choose "x.y.z" as the version to be released
3. `git show` - verify the changes of the version commit
4. `yarn build` - only build the package after the "yarn version" command so the bundled "package.json" uses the updated
   version
5. `yarn publish --access public`
6. `git push --follow-tags` - to push the commits to a "main" branch
