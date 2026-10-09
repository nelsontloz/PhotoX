Feature: Trash

  Scenario: A trashed photo appears in trash and can be restored
    Given I am signed in
    And I upload "photo.jpg"
    When I trash the uploaded asset through the API
    And I open "/trash"
    Then the trash page shows exactly one item
    When I click the photo thumbnail
    Then the viewer is open on that photo
    When I restore the photo from the viewer
    Then the trash is empty
    When I open "/"
    Then the timeline shows exactly one item

  Scenario: Permanently deleting and emptying trash clears items
    Given I am signed in
    And I uploaded two photos through the API
    When I trash both uploaded photos through the API
    And I open "/trash"
    Then the trash page shows exactly two items
    When I open the first trashed item in the viewer
    And I permanently delete the open photo from the viewer
    Then the trash page shows exactly one item
    And the permanently deleted photo is gone through the API
    When I empty the trash
    Then the trash is empty
