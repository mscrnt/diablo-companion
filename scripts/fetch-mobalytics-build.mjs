#!/usr/bin/env node
// fetch-mobalytics-build.mjs
//
// Fetches a Mobalytics Diablo 4 build document and saves it, in Mobalytics' RAW
// document shape (the `data` object of userGeneratedDocumentBySlug: id, slugifiedName,
// content[], data.buildVariants.values[...], author, tags, updatedAt, ...), to
// data/builds/<slug>.json.
//
// Node 22+, ESM, zero dependencies.
//
// Usage:
//   node scripts/fetch-mobalytics-build.mjs <url|slug|uuid> [--variant <id>] [--out <dir>] [--no-fallback]
//
// Accepted inputs:
//   https://mobalytics.gg/diablo-4/builds/<featured-slug>[?ws-ngf5-1=activeVariantId%2C2]
//   https://mobalytics.gg/diablo-4/profile/<author>/builds/<slugified-name|uuid>
//   <featured-slug>                (e.g. necromancer-mages-necro-guide)
//   <author>/<slugified-name>      (profile build)
//   <uuid>                         (document id)
//
// --variant <id> : additionally writes data/builds/<slug>.variant-<id>.json containing just
//                  that entry of data.buildVariants.values (the main file always has all variants).
//                  If omitted but the URL carries activeVariantId, that id is used.
//
// Strategy:
//   1. POST the GraphQL document below directly to
//      https://mobalytics.gg/api/diablo4/v1/graphql/query (not behind Cloudflare).
//   2. If that fails, fetch the page HTML through FlareSolverr (FLARESOLVERR_URL env,
//      default http://192.168.69.197:8191/v1) and pull the document out of
//      window.__PRELOADED_STATE__ (diablo4State.apollo.graphqlV2.queries[*].state.data).
//
// The GraphQL document (also saved verbatim as scripts/mobalytics-build-query.graphql)
// contains three operations sharing the site's own fragments, which were copied from
// Mobalytics' JS bundle (main.<hash>.js; site operations Diablo4UgFeaturedDocumentQuery /
// Diablo4UgNormalDocumentBySlugQuery / Diablo4UgNormalDocumentByIdQuery, trimmed to the
// document field only). The response `data` is byte-for-byte the same shape as the
// document embedded in the page's __PRELOADED_STATE__.
//
//   operationName                 field                                         $input
//   Diablo4BuildBySlug            userGeneratedDocumentBySlug                   { type: "builds", slug }
//   Diablo4BuildBySlugifiedName   userGeneratedDocumentBySlugifiedNameV2        { type: "builds", authorProfileName, slugifiedName }
//   Diablo4BuildById              userGeneratedDocumentById                     { id }
//
// (Each field is aliased to `document`, so the result is always at
//  data.game.documents.document.{error,data}.)
//
// Exported: BUILD_QUERY, parseBuildInput, fetchBuildViaGraphQL, fetchBuildViaFlareSolverr,
//           extractDocumentFromHtml, fetchBuild, getVariant, saveBuild.

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ENDPOINT = 'https://mobalytics.gg/api/diablo4/v1/graphql/query';
export const SITE = 'https://mobalytics.gg';
export const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
export const FLARESOLVERR_URL = process.env.FLARESOLVERR_URL || 'http://192.168.69.197:8191/v1';

// ===== GraphQL document (identical to scripts/mobalytics-build-query.graphql) =====
// Operations (the fragments they spread follow them inside BUILD_QUERY):
//
//   query Diablo4BuildBySlug($input: Diablo4UserGeneratedDocumentInputBySlug!) {
//     game: diablo4 {
//       documents {
//         document: userGeneratedDocumentBySlug(input: $input) {
//           error
//           data {
//             ...NgfUgDocumentFragment
//             ...Diablo4UgDocumentFragment
//           }
//         }
//       }
//     }
//   }
//
//   query Diablo4BuildBySlugifiedName($input: NgfUserGeneratedDocumentInputBySlugifiedNameV2!) {
//     game: diablo4 {
//       documents {
//         document: userGeneratedDocumentBySlugifiedNameV2(input: $input) {
//           error
//           data {
//             ...NgfUgDocumentFragment
//             ...Diablo4UgDocumentFragment
//           }
//         }
//       }
//     }
//   }
//
//   query Diablo4BuildById($input: Diablo4UserGeneratedDocumentInputById!) {
//     game: diablo4 {
//       documents {
//         document: userGeneratedDocumentById(input: $input) {
//           error
//           data {
//             ...NgfUgDocumentFragment
//             ...Diablo4UgDocumentFragment
//           }
//         }
//       }
//     }
//   }
//
// ...followed by the fragments NgfUgDocumentFragment, Diablo4UgDocumentFragment and everything they spread
// (genericBuilder slots w/ gameEntity + modifiers, skillTree, assignedSkills, paragon, mercenary, warPlan,
// equipmentPriorityList, talismansPriorityList, author, tags, seo, content (rich text widgets), ...).
export const BUILD_QUERY = `query Diablo4BuildBySlug($input: Diablo4UserGeneratedDocumentInputBySlug!) {
  game: diablo4 {
    documents {
      document: userGeneratedDocumentBySlug(input: $input) {
        error
        data {
          ...NgfUgDocumentFragment
          ...Diablo4UgDocumentFragment
        }
      }
    }
  }
}

query Diablo4BuildBySlugifiedName($input: NgfUserGeneratedDocumentInputBySlugifiedNameV2!) {
  game: diablo4 {
    documents {
      document: userGeneratedDocumentBySlugifiedNameV2(input: $input) {
        error
        data {
          ...NgfUgDocumentFragment
          ...Diablo4UgDocumentFragment
        }
      }
    }
  }
}

query Diablo4BuildById($input: Diablo4UserGeneratedDocumentInputById!) {
  game: diablo4 {
    documents {
      document: userGeneratedDocumentById(input: $input) {
        error
        data {
          ...NgfUgDocumentFragment
          ...Diablo4UgDocumentFragment
        }
      }
    }
  }
}

fragment Diablo4UgDocumentFragment on Diablo4UserGeneratedDocument {
matchingInfo {
  ...Diablo4UgDocumentMatchingInfoFragment
}
data {
  ...Diablo4UgDocumentDataFragment
}
content: contentV2 {
  ...Diablo4DocumentContentFragment
}
  }

fragment Diablo4DocumentContentFragment on NgfDocumentContent {
...NgfDocumentContentFragment
... on Diablo4DocumentCmWidgetV1 {
  data {
    title
    content
    border
  }
}
... on NgfDocumentCmWidgetDiscoveryPreviewV2 {
  ...Diablo4DocumentCmWidgetDiscoveryPreviewV2Fragment
}
... on NgfDocumentStWidgetDocumentsDiscoveryV1 {
  ...Diablo4DocumentStWidgetDocumentsDiscoveryV1Fragment
}
...Diablo4DocumentUgWidgetSkillTreeV1Fragment
...Diablo4DocumentUgWidgetAssignedSkillsV1Fragment
...Diablo4DocumentUgWidgetParagonV1Fragment
...Diablo4DocumentUgWidgetMercenaryV1Fragment
...Diablo4DocumentUgWidgetTrackingV1Fragment
...Diablo4DocumentUgWidgetLootFilterV1Fragment
...Diablo4DocumentUgWidgetWarPlansV1Fragment
  }

fragment Diablo4DocumentUgWidgetWarPlansV1Fragment on Diablo4DocumentUgWidgetWarPlansV1 {
data {
  descriptionWarPlans: description {
    charLimit
    placeholder
    value
  }
  subTitleWarPlans: subTitle
  title
}
  }

fragment Diablo4DocumentUgWidgetLootFilterV1Fragment on Diablo4DocumentUgWidgetLootFilterV1 {
data {
  subTitleLootFilter: subTitle {
    charLimit
    placeholder
    value
  }
  title
}
  }

fragment Diablo4DocumentUgWidgetTrackingV1Fragment on Diablo4DocumentUgWidgetTrackingV1 {
data {
  subTitleDiablo4Tracking: subTitle {
    charLimit
    placeholder
    value
  }
  title
}
  }

fragment Diablo4DocumentUgWidgetMercenaryV1Fragment on Diablo4DocumentUgWidgetMercenaryV1 {
data {
  descriptionMercenary: description {
    charLimit
    placeholder
    value
  }
  subTitleMercenary: subTitle
  title
}
  }

fragment Diablo4DocumentUgWidgetParagonV1Fragment on Diablo4DocumentUgWidgetParagonV1 {
data {
  descriptionParagon: description {
    charLimit
    placeholder
    value
  }
  subTitleParagon: subTitle
  title
  paragonNodesLimit
  renownValue
}
  }

fragment Diablo4DocumentUgWidgetAssignedSkillsV1Fragment on Diablo4DocumentUgWidgetAssignedSkillsV1 {
data {
  descriptionAssignedSkills: description {
    charLimit
    placeholder
    value
  }
  subTitleAssignedSkills: subTitle
  title
}
  }

fragment Diablo4DocumentUgWidgetSkillTreeV1Fragment on Diablo4DocumentUgWidgetSkillTreeV1 {
data {
  descriptionSkillTree: description {
    charLimit
    placeholder
    value
  }
  subTitleSkillTree: subTitle
  title
  maxLevel
}
  }

fragment Diablo4DocumentStWidgetDocumentsDiscoveryV1Fragment on NgfDocumentStWidgetDocumentsDiscoveryV1 {
data {
  discovery {
    items {
      error
      pageInfo {
        hasMoreItems
        cursor
        total
      }
      documents {
        data {
          ... on Diablo4UserGeneratedDocumentData {
            ...Diablo4DiscoveryDocumentDataFragment
          }
        }
      }
    }
  }
}
  }

fragment Diablo4DiscoveryDocumentDataFragment on NgfUserGeneratedDocumentData {
...NgfDiscoveryDocumentDataFragment
... on Diablo4UserGeneratedDocumentData {
  ...Diablo4UgDocumentBuildVariantSkillTreeV1Fragment
  ...Diablo4UgDocumentBuildVariantAssignedSkillsV1Fragment
}
  }

fragment Diablo4UgDocumentBuildVariantAssignedSkillsV1Fragment on Diablo4UserGeneratedDocumentData {
buildVariants {
  values {
    id
    assignedSkills {
      summons {
        type
        upgrade
        spec {
          ...D4BuildVariantSkillTreeSkillFragment
        }
      }
      expertise {
        ...D4BuildVariantSkillTreeSkillFragment
      }
      specialization {
        ...D4BuildVariantSkillTreeSkillFragment
      }
      enchantments {
        ...D4BuildVariantSkillTreeSkillFragment
      }
      spiritGuardians {
        primaryId
        secondaryId
      }
      boons {
        type
        value {
          ...D4BuildVariantSkillTreeSkillFragment
        }
      }
      soulShards {
        shard {
          slug
        }
        fragments {
          slug
        }
      }
      skills {
        position
        weaponArsenalSlot {
          slug
          iconUrl
        }
        skill {
          ...D4BuildVariantSkillTreeSkillFragment
        }
      }
    }
  }
}
  }

fragment D4BuildVariantSkillTreeSkillFragment on D4Skill {
id
slug
classSlug
class {
  name
}
name
description
enchantment
maxRank
requiredRank
iconUrl
x
y
section {
  id
  name
}
disables {
  id
  type {
    id
    name
  }
}
dependsOnSlugs
type {
  id
  slug
  name
}
tags {
  name
}
resources {
  value
  name
}
substitutions {
  key
  values
}
  }

fragment Diablo4UgDocumentBuildVariantSkillTreeV1Fragment on Diablo4UserGeneratedDocumentData {
buildVariants {
  values {
    id
    skillTree {
      skills {
        actionType
        skill {
          slug
          type: typeV2 {
            id
          }
        }
      }
      priorityList {
        iconURL
        slug
        type
      }
    }
  }
}
  }

fragment NgfDiscoveryDocumentDataFragment on NgfUserGeneratedDocumentData {
name
childrenIds
backgroundImage
tierLists {
  ...NgfDocumentDataTierListsFragment
}
  }

fragment NgfDocumentDataTierListsFragment on NgfDocumentTierListData {
values {
  id
  tierSections {
    name
    color
    description
    ugDataItems {
      id
      iconUrl
      linkUrl
      title
      subTitle
      tags {
        groupSlug
        slug
      }
    }
    staticDataItems {
      iconUrl
      linkUrl
      name
      slug
      type
    }
  }
  ugDocSources {
    iconStyle
    slug
    tags {
      slug
      groupSlug
    }
    uiCapabilities {
      tagFilters {
        groupSlug
        ui {
          enabled
          type
        }
      }
    }
  }
  staticDataSources {
    showTitles
    iconStyle
    slug
    tags {
      slug
      groupSlug
    }
    uiCapabilities {
      tagFilters {
        groupSlug
        ui {
          enabled
          type
        }
      }
    }
  }
}
  }

fragment Diablo4DocumentCmWidgetDiscoveryPreviewV2Fragment on NgfDocumentCmWidgetDiscoveryPreviewV2 {
data {
  discovery {
    items {
      documents {
        ... on Diablo4UserGeneratedDocument {
          data {
            ...Diablo4DiscoveryDocumentDataFragment
          }
        }
      }
    }
  }
  isStickyInEditingMode
  isStickyInViewMode
  title
}
id
meta {
  config {
    editable
    movable
    removable
  }
}
  }

fragment NgfDocumentContentFragment on NgfDocumentContent {
# Document Cm
...NgfDocumentContentCommonFragment
... on NgfDocumentCmWidgetDocumentsFeedV1 {
  data {
    title
    optionalDescription: description
    buttonLinkUrl
    openButtonLinkInNewTab
    optionalButtonTitle: buttonTitle
    discovery {
      ...NgfDocumentContentDiscoveryFragment
    }
  }
}
... on NgfDocumentCmWidgetDocumentsFeedV2 {
  data {
    title
    optionalSubTitleV2: subTitle
    buttonLinkUrl
    openButtonLinkInNewTab
    optionalButtonTitle: buttonTitle
    discovery {
      ...NgfDocumentContentDiscoveryFragment
    }
  }
}
... on NgfDocumentCmWidgetUGTierListV1 {
  __typename
  id
  data {
    title
    optionalDescription: description
    childrenIds
    searchByAuthor {
      enabled
    }
    searchByName {
      enabled
    }
    tagFilters {
      groupSlug
      ui {
        enabled
        type
      }
    }
    iconStyle
    discovery {
      ...NgfDocumentContentDiscoveryFragment
    }
  }
}
... on NgfDocumentCmWidgetUGTierListV2 {
  __typename
  id
  data {
    title
    optionalSubTitleV2: subTitle
    childrenIds
    searchByAuthor {
      enabled
    }
    searchByName {
      enabled
    }
    tagFilters {
      groupSlug
      ui {
        enabled
        type
      }
    }
    iconStyle
    discovery {
      ...NgfDocumentContentDiscoveryFragment
    }
  }
}
... on NgfDocumentStWidgetLinksGridManualV1 {
  data {
    title
    optionalDescription: description
    items {
      title
      subTitle
      requiredLinkUrl: linkUrl
      openLinkInNewTab
      backgroundCss
      backgroundImageMask
      position
    }
  }
}
... on NgfDocumentStWidgetLinksGridManualV2 {
  data {
    title
    optionalSubTitleV2: subTitle
    items {
      title
      subTitle
      requiredLinkUrl: linkUrl
      openLinkInNewTab
      backgroundCss
      backgroundImageMask
      position
    }
  }
}
... on NgfDocumentCmSectionAuto1V1 {
  data {
    childrenIds
  }
}
... on NgfDocumentCmSectionAuto3V1 {
  data {
    childrenIds
  }
}
... on NgfDocumentCmSectionAuto400V1 {
  data {
    childrenIds
  }
}
... on NgfDocumentCmSectionVideoAdV1 {
  data {
    childrenIds
  }
}
... on NgfDocumentCmWidgetErrorV1 {
  data {
    error
  }
}
... on NgfDocumentCmWidgetRichTextV1 {
  data {
    title
    optionalContent: content
  }
}
... on NgfDocumentCmWidgetRichTextSimplifiedV1 {
  ...NgfDocumentCmWidgetRichTextSimplifiedV1Fragment
}
... on NgfDocumentCmWidgetRichTextSimplifiedV2 {
  ...NgfDocumentCmWidgetRichTextSimplifiedV2Fragment
}
... on NgfDocumentCmWidgetRichTextV2 {
  data {
    title
    optionalSubTitleV2: subTitle
    contentV2: content
  }
}
... on NgfDocumentCmWidgetCardGridV1 {
  data {
    title
    optionalDescription: description
    optionalSubTitle: subTitle
    cardLayout
    items {
      title
      subtitle
      imageUrl
      linkUrl
      openLinkInNewTab
    }
  }
}
... on NgfDocumentCmWidgetCardGridV2 {
  data {
    title
    optionalDescriptionV2: description {
      charLimit
      placeholder
      value
    }
    optionalSubTitleV2: subTitle
    cardLayoutV2: cardLayout
    items {
      title
      subtitle
      imageUrl
      linkUrl
      openLinkInNewTab
    }
  }
}
... on NgfDocumentCmWidgetPromoBannerHorizontalV1 {
  data {
    title
    subTitle
    buttonColor
    buttonTitle
    buttonTextColor
    backgroundCss
    backgroundImageMask
    linkUrl
    openLinkInNewTab
    platforms
    userLevels
    mixpanelSlug
  }
}
... on NgfDocumentCmWidgetGameDataCardGridV1 {
  data {
    title
    optionalDescription: description
    optionalSubTitle: subTitle
    iconStyle
    layout
    items {
      slug
      groupSlug
      title
      subTitle
      linkUrl
      openLinkInNewTab
      imageUrl
      iconStyle
    }
  }
}
... on NgfDocumentCmWidgetGameDataCardGridV2 {
  data {
    title
    optionalDescriptionV2: description {
      charLimit
      placeholder
      value
    }
    optionalSubTitleV2: subTitle
    iconStyle
    layoutV2: layout
    items {
      slug
      groupSlug
      title
      subTitle
      linkUrl
      openLinkInNewTab
      imageUrl
      iconStyle
    }
  }
}
... on NgfDocumentCmWidgetVideoV1 {
  data {
    title
    optionalDescription: description
    autoplay
    videoUrl
  }
}
... on NgfDocumentCmWidgetVideoV2 {
  data {
    title
    optionalSubTitleV2: subTitle
    autoplay
    loop
    videoUrl
  }
}
... on NgfDocumentCmWidgetDisplayAdsV1 {
  data {
    title
    platform {
      type
      size
    }
    isStickyInEditingMode
    isStickyInViewMode
  }
}
... on NgfDocumentCmWidgetPromoBannerNetboardV1 {
  data {
    title
    subTitle
    buttonColor
    buttonTitle
    buttonTextColor
    backgroundCss
    backgroundImageMask
    linkUrl
    openLinkInNewTab
    platforms
    userLevels
    mixpanelSlug
  }
}
... on NgfDocumentCmWidgetDiscoveryPreviewV1 {
  data {
    title
    optionalDescription: description
    optionalButtonTitle: buttonTitle
    buttonLinkUrl
    openButtonLinkInNewTab
    discovery {
      ...NgfDocumentContentDiscoveryFragment
    }
  }
}
... on NgfDocumentCmWidgetDiscoveryPreviewV2 {
  data {
    title
    optionalSubTitleV2: subTitle
    optionalButtonTitle: buttonTitle
    buttonLinkUrl
    openButtonLinkInNewTab
    discovery {
      ...NgfDocumentContentDiscoveryFragment
    }
  }
}
... on NgfDocumentCmWidgetDiscoveryPreviewCompactV1 {
  data {
    title
    optionalDescription: description
    optionalButtonTitle: buttonTitle
    buttonLinkUrl
    openButtonLinkInNewTab
    visual
    discovery {
      ...NgfDocumentContentDiscoveryFragment
    }
  }
}
... on NgfDocumentCmWidgetDiscoveryPreviewCompactV2 {
  data {
    title
    optionalSubTitleV2: subTitle
    optionalButtonTitle: buttonTitle
    buttonLinkUrl
    openButtonLinkInNewTab
    visualV2: visual
    discovery {
      ...NgfDocumentContentDiscoveryFragment
    }
  }
}
... on NgfDocumentCmWidgetCommentsV1 {
  ...NgfDocumentCmWidgetCommentsV1Fragment
}
... on NgfDocumentCmWidgetContentVariantsV1 {
  ...NgfDocumentCmWidgetContentVariantsV1Fragment
}
... on NgfDocumentCmWidgetCrossPageTabBarV1 {
  data {
    items {
      title
      path
      tag
    }
  }
}
... on NgfDocumentCmWidgetTableOfContentV1 {
  ...NgfDocumentCmWidgetTableOfContentV1Fragment
}
... on NgfDocumentCmWidgetWikiDiscoveryDetailedV1 {
  data {
    discovery {
      ...NgfWikiDocumentsDiscoveryFragment
    }
    uiCapabilities {
      ...NgfDocumentDiscoveryUiCapabilitiesFragment
    }
  }
}
... on NgfDocumentCmWidgetStrengthsAndWeaknessesV1 {
  ...NgfDocumentCmWidgetStrengthsAndWeaknessesV1Fragment
}
# Document UG
... on NgfDocumentUgWidgetHeaderV1 {
  data {
    title
  }
}
# Document St
... on NgfDocumentStWidgetHeaderV1 {
  data {
    title
    description
    backgroundCss
    backgroundImageMask
  }
}
... on NgfDocumentStWidgetHeaderV2 {
  data {
    title
    optionalSubTitleV2: subTitle
    backgroundCss
    backgroundImageMask
  }
}
... on NgfDocumentStWidgetHomePageHeaderV1 {
  data {
    title
    description
    backgroundCss
    backgroundImageMask
  }
}
... on NgfDocumentStWidgetHomePageHeaderV2 {
  data {
    title
    optionalSubTitleV2: subTitle
    backgroundCss
    backgroundImageMask
  }
}
... on NgfDocumentStWidgetDocumentsDiscoveryV1 {
  data {
    discovery {
      ...NgfDocumentContentDiscoveryFragment
    }
    uiCapabilities {
      ...NgfDocumentDiscoveryUiCapabilitiesFragment
    }
  }
}
... on NgfDocumentCmWidgetTierListMakerV1 {
  data {
    title
    isStickyInViewMode
    isStickyInEditingMode
    descriptionPlaceholder
    descriptionCharacterLimit
    descriptionMap: description
    filtersEnabled
    searchByName {
      enabled
    }
    tierListMakerTagFilters: tagFilters {
      groupSlug
      ui {
        enabled
        type
      }
    }
  }
}
# Document Wk
... on NgfDocumentWkSectionSlotV1 {
  data {
    childrenIds
  }
}
...NgfDocumentCmWidgetMapV1Fragment
...NgfDocumentUgWidgetBuilderV1Fragment
  }

fragment NgfDocumentUgWidgetBuilderV1Fragment on NgfDocumentUgWidgetBuilderV1 {
data {
  title
  optionalSubTitleV2: subTitle
  simplifiedContent: description {
    value
    charLimit
    placeholder
  }
  theme
  showEmptyGroups
  showEmptySlots
  groups {
    title
    slug
    slotView
    slotIconFill
    slotIconStyle
    slotsPerRow
    displayTitle
    dependableTags {
      groupSlug
      slug
    }
    slots {
      title
      gameSlotSlug
      allowedGameDataGroups {
        groupName
      }
      dependableTags {
        groupSlug
        slug
      }
    }
  }
}
  }

fragment NgfDocumentCmWidgetMapV1Fragment on NgfDocumentCmWidgetMapV1 {
data {
  title
  optionalSubTitleV2: subTitle
  simplifiedContent: description {
    value
    charLimit
    placeholder
  }
  mapConfig
  featureEntities {
    featureId
    gameEntity {
      ...NgfDocumentGameEntityFragment
    }
  }
}
  }

fragment NgfDocumentGameEntityFragment on NGFEntityObject {
slug
title
type
iconUrl
color
  }

fragment NgfDocumentDiscoveryUiCapabilitiesFragment on NgfDocumentStWidgetDocumentsDiscoveryV1UICapabilities {
sorting {
  defaultSortingOption
  enabled
}
searchByName {
  enabled
}
searchByAuthor {
  enabled
}
publishedTimeframe {
  defaultTimeFrame
  enabled
}
tagFilters {
  groupSlug
  ui {
    enabled
    type
  }
}
loadingBehaviour
  }

fragment NgfDocumentContentDiscoveryFragment on NgfUserGeneratedDocumentsDiscovery {
...NgfDocumentContentDiscoveryBaseFragment
items {
  error
  pageInfo {
    hasMoreItems
    cursor
    total
  }
  documents {
    ...NgfDocumentContentDiscoveryDocumentItemBaseFragment
    data {
      ...NgfDiscoveryDocumentDataFragment
    }
  }
}
  }

fragment NgfDocumentContentDiscoveryDocumentItemBaseFragment on NgfUserGeneratedDocument {
id
category
slugifiedName
tags {
  data {
    ...NgfDocumentTagFragment
  }
}
data {
  ...NgfDiscoveryDocumentDataFragment
}
type
typeData {
  slug
  displayMetadata {
    coverImageUrlPattern
  }
}
version
status
author {
  ...NgfDocumentAuthorFragment
}
seo {
  ...NgfDocumentSeoFragment
}
favorites {
  ...NgfDocumentFavoritesFragment
}
comments {
  ...NgfDocumentCommentsFragment
}
featured {
  ...NgfDocumentFeaturedFragment
}
createdAt
updatedAt
firstPublishedAt
  }

fragment NgfDocumentFeaturedFragment on NgfDocumentFeatured {
slug
status
  }

fragment NgfDocumentCommentsFragment on NgfDocumentComments {
stats {
  totalComments
}
  }

fragment NgfDocumentFavoritesFragment on NgfDocumentFavorites {
isFavorite
favoritesCount
  }

fragment NgfDocumentSeoFragment on NgfDocumentSeo {
title
description
ogImage
schemaMarkup
canonicalUrl
noIndex
  }

fragment NgfDocumentAuthorFragment on NgfDocumentAuthor {
id
name
isCreator
links {
  url
  network {
    id
    name
    iconUrl
  }
}
twitchLive {
  live
  login
}
user {
  username
  displayName
}
  }

fragment NgfDocumentTagFragment on NgfDocumentTag {
groupSlug
archived
description
iconUrl
imageUrl
pluralName
name
slug
linkUrl
linkedTags {
  groupSlug
  slugs
}
  }

fragment NgfDocumentContentDiscoveryBaseFragment on NgfUserGeneratedDocumentsDiscovery {
cursor
limit
ids
slugs
authorId
type
name
seasonSlug
tierSlug
tags {
  groupSlug
  slug
}
initialState {
  tags {
    groupSlug
    slug
  }
}
documentStatus
featuredStatuses
isFavorite
publishedTimeframe
sortBy
  }

fragment NgfDocumentCmWidgetStrengthsAndWeaknessesV1Fragment on NgfDocumentCmWidgetStrengthsAndWeaknessesV1 {
data {
  title
  subTitleStrengthsAndWeaknesses: subTitle {
    value
    charLimit
    placeholder
  }
  pointsLimit
  layoutStrengthsAndWeaknesses: layout
  strengths {
    value
    charLimit
    placeholder
  }
  weaknesses {
    value
    charLimit
    placeholder
  }
}
  }

fragment NgfWikiDocumentsDiscoveryFragment on NgfWikiDocumentsDiscovery {
...NgfWikiDocumentsDiscoveryBaseFragment
items {
  error
  pageInfo {
    cursor
    hasMoreItems
    total
  }
  documents {
    ...NgfWikiDocumentLiteFragment
  }
}
  }

fragment NgfWikiDocumentLiteFragment on NgfWikiDocument {
id
category
version
createdAt
updatedAt
slug
type
seo {
  ...NgfDocumentSeoFragment
}
tags {
  data {
    ...NgfDocumentTagFragment
  }
}
data {
  ...NgfWikiDocumentDataFragment
}
  }

fragment NgfWikiDocumentDataFragment on NgfWikiDocumentData {
name
childrenIds
tierLists {
  ...NgfDocumentDataTierListsFragment
}
  }

fragment NgfWikiDocumentsDiscoveryBaseFragment on NgfWikiDocumentsDiscovery {
cursor
limit
name
staticDataType
tags {
  groupSlug
  slug
}
initialState {
  tags {
    groupSlug
    slug
  }
}
wikiSortBy: sortBy
  }

fragment NgfDocumentCmWidgetTableOfContentV1Fragment on NgfDocumentCmWidgetTableOfContentV1 {
data {
  stub
}
  }

fragment NgfDocumentCmWidgetContentVariantsV1Fragment on NgfDocumentCmWidgetContentVariantsV1 {
id
data {
  title
  childrenVariants {
    id
    title
    description {
      value
      placeholder
      charLimit
    }
    childrenIds
  }
}
  }

fragment NgfDocumentCmWidgetCommentsV1Fragment on NgfDocumentCmWidgetCommentsV1 {
data {
  isDisabled
  payload {
    ...NgfCommentsPayloadFieldsFragment
  }
  commentsUiCapabilities: uiCapabilities {
    loadingBehaviour
    sorting {
      enabled
      defaultSortingOption
    }
  }
}
  }

fragment NgfCommentsPayloadFieldsFragment on CommentsPayload {
resourceId
commentId
cutoffDate
error {
  code
  message
  retryAfterSeconds
}
page {
  hasMoreItems
  nextCursor
}
data {
  parentId
  sortBy
  limit
  comments {
    ...NgfCommentFieldsFragment
  }
}
  }

fragment NgfCommentFieldsFragment on CommentsComment {
id
parentId
resourceId
depth
accountId
content
plainTextContent
status
createdAt
updatedAt
deletedAt
deletedByModerator
deletedReason
publishedAt
isSpoiler
spoilerLabel
isBeforeCutoff
score
upvotes
downvotes
viewerVote
replyCount
profile {
  user {
    id
    username
    displayName
  }
  avatar {
    id
    name
    iconUrl
  }
  avatarFrame {
    id
    name
    iconUrl
  }
  title {
    id
    name
  }
  commentator {
    stats {
      totalComments
    }
  }
}
  }

fragment NgfDocumentCmWidgetRichTextSimplifiedV2Fragment on NgfDocumentCmWidgetRichTextSimplifiedV2 {
data {
  title
  optionalSubTitleV2: subTitle
  simplifiedContent: content {
    value
    charLimit
    placeholder
  }
}
  }

fragment NgfDocumentCmWidgetRichTextSimplifiedV1Fragment on NgfDocumentCmWidgetRichTextSimplifiedV1 {
data {
  title
  optionalContent: content
}
  }

fragment NgfDocumentContentCommonFragment on NgfDocumentContent {
__typename
id
data {
  isStickyInEditingMode
  isStickyInViewMode
  focusMode {
    enabled
  }
}
  }

fragment Diablo4UgDocumentDataFragment on Diablo4UserGeneratedDocumentData {
...Diablo4UgDocumentBuildVariantSkillTreeV1Fragment
...Diablo4UgDocumentBuildVariantAssignedSkillsV1Fragment
...Diablo4UgDocumentBuildVariantParagonV1Fragment
...Diablo4UgDocumentBuildVariantMercenaryV1Fragment
...Diablo4UgDocumentBuildVariantWarPlanV1Fragment
...Diablo4UgDocumentDataBuildVariantsFragment
lootFilter
  }

fragment Diablo4UgDocumentDataBuildVariantsFragment on Diablo4UserGeneratedDocumentData {
buildVariants {
  values {
    id
    equipmentPriorityList {
      slug
      type
      iconURL
      modifiers {
        iconURL
        slug
        type
      }
      notes {
        value
        placeholder
        charLimit
      }
    }
    talismansPriorityList {
      slug
      type
      iconURL
      modifiers {
        iconURL
        slug
        type
      }
      notes {
        value
        placeholder
        charLimit
      }
    }
    genericBuilder {
      slots {
        gameSlotSlug
        gameEntity {
          modifiers {
            gearStats {
              id
              isGreater
              isMasterwork
            }
            implicitStats {
              id
            }
            socketStats {
              slug
              type
              ... on D4EntityObject {
                entity {
                  ... on D4Gem {
                    __typename
                    iconUrl
                  }
                  ... on D4Rune {
                    type
                    __typename
                  }
                }
              }
            }
            temperingStats {
              id
              isGreater
              isMasterwork
            }
            sealStats {
              id
            }
            charmStats {
              id
            }
            transfiguredStats {
              id
            }
            kulleanTransfiguredStats {
              id
            }
            isMythic
          }
          entity {
            ... on D4Seal {
              __typename
              iconUrl
              title: name
              rarity
            }
            ... on D4Charm {
              __typename
              iconUrl
              title: name
              rarity
            }
            ... on D4ChaosPerk {
              __typename
              iconUrl
              title: name
              rarity
            }
            ... on D4Aspect {
              __typename
              iconUrl
              title: name
            }
            ... on D4UniqueItem {
              __typename
              iconUrl
              title: name
              chaos
              mythic
            }
            ... on D4TriadPower {
              __typename
              iconUrl
              title: name
              splinterSlug
            }
          }
        }
      }
    }
  }
}
  }

fragment Diablo4UgDocumentBuildVariantWarPlanV1Fragment on Diablo4UserGeneratedDocumentData {
buildVariants {
  values {
    id
    warPlan {
      warplanTrees {
        warplanTree {
          slug
        }
        warplanNodes {
          slug
        }
      }
    }
  }
}
  }

fragment Diablo4UgDocumentBuildVariantMercenaryV1Fragment on Diablo4UserGeneratedDocumentData {
buildVariants {
  values {
    id
    mercenary {
      opportunity {
        opportunity {
          slug
        }
        skill {
          slug
        }
      }
      primaryMercenary {
        slug
      }
      reinforcementMercenary {
        slug
      }
      skill {
        slug
      }
      skillTree {
        actionType
        skill {
          slug
        }
      }
    }
  }
}
  }

fragment Diablo4UgDocumentBuildVariantParagonV1Fragment on Diablo4UserGeneratedDocumentData {
buildVariants {
  values {
    id
    paragon {
      nodes {
        slug
      }
      boards {
        x
        y
        rotation
        board {
          slug
        }
        glyph {
          slug
        }
        glyphLevel
      }
      priorityList {
        iconURL
        slug
        type
      }
    }
  }
}
  }

fragment Diablo4UgDocumentMatchingInfoFragment on NgfMatchingInfo {
id

autoSyncInterval
autoTrackingDisabled

error
errorMessage

nextItems {
  ...NgfMatchableEntityFragment
  children {
    ...NgfMatchableEntityFragment
    children {
      ...NgfMatchableEntityFragment
    }
  }
}
items {
  ...NgfMatchableEntityFragment
  children {
    ...NgfMatchableEntityFragment
    children {
      ...NgfMatchableEntityFragment
      children {
        ...NgfMatchableEntityFragment
      }
    }
  }
}

matchingTarget {
  key
}
variantId
  }

fragment NgfMatchableEntityFragment on NgfMatchableEntity {
id
slug
name
isNext
matchRate
matched
type
targetName
targetSlug
lastMatchedTime
autoTrackingDisabled
  }

fragment NgfUgDocumentFragment on NgfUserGeneratedDocument {
id
category
slugifiedName
type
typeData {
  slug
  displayMetadata {
    coverImageUrlPattern
  }
}
content: contentV2 {
  ...NgfDocumentContentFragment
}
data {
  ...NgfUgDocumentDataFragment
}
version
status
author {
  ...NgfDocumentAuthorFragment
}
seo {
  ...NgfDocumentSeoFragment
}
favorites {
  ...NgfDocumentFavoritesFragment
}
comments {
  ...NgfDocumentCommentsFragment
}
featured {
  ...NgfDocumentFeaturedFragment
}
tags {
  data {
    ...NgfDocumentTagFragment
  }
}
createdAt
updatedAt
firstPublishedAt
  }

fragment NgfUgDocumentDataFragment on NgfUserGeneratedDocumentData {
name
childrenIds
backgroundImage
tierLists {
  ...NgfDocumentDataTierListsFragment
}
...NgfUgDocumentDataBuildVariantsFragment
  }

fragment NgfUgDocumentDataBuildVariantsFragment on NgfUserGeneratedDocumentData {
buildVariants {
  values {
    id
    genericBuilder {
      slots {
        gameSlotSlug
        gameEntity {
          ...NgfDocumentGameEntityFragment
        }
      }
    }
  }
}
  }
`;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Parse a URL / slug / uuid into a lookup descriptor:
 *   { kind: 'featured', slug } | { kind: 'profile', author, slugifiedName } | { kind: 'id', id }
 * plus { variantId, pageUrl, fileSlug }.
 */
export function parseBuildInput(input, variantId = null) {
  let s = String(input).trim();
  let urlVariant = null;
  let pageUrl = null;
  let res;
  if (/^https?:\/\//i.test(s)) {
    const u = new URL(s);
    pageUrl = `${u.origin}${u.pathname}`;
    for (const [k, v] of u.searchParams) {
      const m = /activeVariantId,([^,&]+)/.exec(`${k}=${v}`) || /activeVariantId,([^,&]+)/.exec(v);
      if (m) urlVariant = m[1];
    }
    const parts = u.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    const bi = parts.lastIndexOf('builds');
    if (bi < 0 || !parts[bi + 1]) throw new Error(`Unrecognized Mobalytics build URL: ${s}`);
    const last = parts[bi + 1];
    const pi = parts.indexOf('profile');
    if (UUID_RE.test(last)) res = { kind: 'id', id: last };
    else if (pi >= 0 && pi < bi) res = { kind: 'profile', author: parts[pi + 1], slugifiedName: last };
    else res = { kind: 'featured', slug: last };
  } else if (UUID_RE.test(s)) {
    res = { kind: 'id', id: s };
  } else if (s.includes('/')) {
    const [author, slugifiedName] = s.split('/').filter(Boolean);
    res = { kind: 'profile', author, slugifiedName };
  } else {
    res = { kind: 'featured', slug: s };
  }
  if (!pageUrl) {
    pageUrl =
      res.kind === 'featured'
        ? `${SITE}/diablo-4/builds/${res.slug}`
        : res.kind === 'profile'
          ? `${SITE}/diablo-4/profile/${res.author}/builds/${res.slugifiedName}`
          : null;
  }
  res.variantId = variantId ?? urlVariant;
  res.pageUrl = pageUrl;
  res.fileSlug = res.slug ?? res.slugifiedName ?? res.id;
  return res;
}

function operationFor(target) {
  switch (target.kind) {
    case 'featured':
      return { operationName: 'Diablo4BuildBySlug', input: { type: 'builds', slug: target.slug } };
    case 'profile':
      return {
        operationName: 'Diablo4BuildBySlugifiedName',
        input: { type: 'builds', authorProfileName: target.author, slugifiedName: target.slugifiedName },
      };
    case 'id':
      return { operationName: 'Diablo4BuildById', input: { id: target.id } };
    default:
      throw new Error(`bad target kind ${target.kind}`);
  }
}

/** Direct GraphQL fetch. Returns the raw document object (or throws). */
export async function fetchBuildViaGraphQL(target, { fetchImpl = fetch } = {}) {
  const { operationName, input } = operationFor(target);
  const res = await fetchImpl(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'User-Agent': USER_AGENT,
      Origin: SITE,
      Referer: target.pageUrl ?? `${SITE}/diablo-4`,
    },
    body: JSON.stringify({ operationName, query: BUILD_QUERY, variables: { input } }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`GraphQL HTTP ${res.status}: ${text.slice(0, 300)}`);
  const json = JSON.parse(text);
  const node = json.data?.game?.documents?.document;
  if (node?.error) throw new Error(`GraphQL document error: ${JSON.stringify(node.error)}`);
  if (!node?.data) {
    throw new Error(`GraphQL returned no document${json.errors ? `: ${JSON.stringify(json.errors).slice(0, 800)}` : ''}`);
  }
  return node.data;
}

/** Locate the build document inside a parsed __PRELOADED_STATE__ object. */
function findDocument(state, target) {
  const hits = [];
  const seen = new Set();
  const walk = (o, depth) => {
    if (!o || typeof o !== 'object' || depth > 25 || seen.has(o)) return;
    seen.add(o);
    if (typeof o.slugifiedName === 'string' && o.data && typeof o.data === 'object' && 'buildVariants' in o.data) {
      hits.push(o);
      return;
    }
    for (const v of Array.isArray(o) ? o : Object.values(o)) walk(v, depth + 1);
  };
  walk(state, 0);
  if (!hits.length) return null;
  const want = target?.slug ?? target?.slugifiedName ?? target?.id;
  return (
    hits.find((h) => h.featured?.slug === want || h.slugifiedName === want || h.id === want) ??
    hits.sort((a, b) => JSON.stringify(b).length - JSON.stringify(a).length)[0]
  );
}

/** Extract window.__PRELOADED_STATE__ JSON from page HTML and return the build document. */
export function extractDocumentFromHtml(html, target = null) {
  const marker = 'window.__PRELOADED_STATE__=';
  let i = html.indexOf(marker);
  let start = i + marker.length;
  if (i < 0) {
    const m = /window\.__PRELOADED_STATE__\s*=\s*/.exec(html);
    if (!m) throw new Error('No window.__PRELOADED_STATE__ in page HTML');
    start = m.index + m[0].length;
  }
  const end = html.indexOf('</script>', start);
  let text = html.slice(start, end < 0 ? undefined : end).trim().replace(/;\s*$/, '');
  let state;
  try {
    state = JSON.parse(text);
  } catch {
    // serialize-javascript style output may contain bare `undefined`; neutralise it (data only, never eval).
    text = text.replace(/([:,\[]\s*)undefined(?=\s*[,}\]])/g, '$1null');
    state = JSON.parse(text);
  }
  const doc = findDocument(state, target);
  if (!doc) throw new Error('Build document not found in __PRELOADED_STATE__');
  return doc;
}

/** FlareSolverr fallback: fetch page HTML (Cloudflare-protected) and parse __PRELOADED_STATE__. */
export async function fetchBuildViaFlareSolverr(target, { flaresolverrUrl = FLARESOLVERR_URL, fetchImpl = fetch } = {}) {
  if (!target.pageUrl) throw new Error('FlareSolverr fallback needs a page URL (not available for bare document ids)');
  const res = await fetchImpl(flaresolverrUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cmd: 'request.get', url: target.pageUrl, maxTimeout: 90000 }),
  });
  const json = await res.json();
  if (json.status !== 'ok') throw new Error(`FlareSolverr: ${json.status} ${json.message ?? ''}`);
  return extractDocumentFromHtml(json.solution?.response ?? '', target);
}

/** Fetch a build: GraphQL first, FlareSolverr fallback. Returns { document, source, target }. */
export async function fetchBuild(input, { variantId = null, fallback = true, log = console } = {}) {
  const target = typeof input === 'object' && input.kind ? input : parseBuildInput(input, variantId);
  try {
    const document = await fetchBuildViaGraphQL(target);
    return { document, source: 'graphql', target };
  } catch (err) {
    if (!fallback) throw err;
    log?.warn?.(`Direct GraphQL fetch failed (${err.message}); trying FlareSolverr ...`);
    const document = await fetchBuildViaFlareSolverr(target);
    return { document, source: 'flaresolverr', target };
  }
}

/** Return one entry of document.data.buildVariants.values (by id, or the first). */
export function getVariant(document, variantId = null) {
  const values = document?.data?.buildVariants?.values ?? [];
  if (variantId == null) return values[0] ?? null;
  return values.find((v) => String(v.id) === String(variantId)) ?? null;
}

export async function saveBuild(document, outDir, fileSlug, { variantId = null } = {}) {
  await mkdir(outDir, { recursive: true });
  const files = [];
  const main = path.join(outDir, `${fileSlug}.json`);
  await writeFile(main, JSON.stringify(document, null, 2) + '\n');
  files.push(main);
  if (variantId != null) {
    const v = getVariant(document, variantId);
    if (!v) throw new Error(`Variant ${variantId} not found (have: ${(document.data?.buildVariants?.values ?? []).map((x) => x.id).join(', ')})`);
    const vf = path.join(outDir, `${fileSlug}.variant-${variantId}.json`);
    await writeFile(vf, JSON.stringify(v, null, 2) + '\n');
    files.push(vf);
  }
  return files;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { input: null, variant: null, out: null, fallback: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => (a.includes('=') ? a.split('=').slice(1).join('=') : argv[++i]);
    if (a.startsWith('--variant')) args.variant = val();
    else if (a.startsWith('--out')) args.out = val();
    else if (a === '--no-fallback') args.fallback = false;
    else if (a === '-h' || a === '--help') args.help = true;
    else if (!args.input) args.input = a;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.input) {
    console.log('Usage: node scripts/fetch-mobalytics-build.mjs <url|slug|author/slug|uuid> [--variant <id>] [--out <dir>] [--no-fallback]');
    process.exit(args.help ? 0 : 1);
  }
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const outDir = path.resolve(args.out ?? path.join(repoRoot, 'data', 'builds'));
  const target = parseBuildInput(args.input, args.variant);
  const { document, source } = await fetchBuild(target, { fallback: args.fallback });
  const files = await saveBuild(document, outDir, target.fileSlug, { variantId: target.variantId });
  const variants = (document.data?.buildVariants?.values ?? []).map((v) => v.id);
  console.log(`"${document.data?.name}" by ${document.author?.name ?? '?'} (updated ${document.updatedAt}) via ${source}`);
  console.log(`variants: ${variants.join(', ')}`);
  for (const f of files) console.log(`wrote ${f}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err.message ?? err);
    process.exit(1);
  });
}
