package com.patrykdolata.familyhub.shoppinglist.domain;

import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.Optional;

import static com.patrykdolata.familyhub.shoppinglist.domain.ShoppingItem.shoppingItem;
import static com.patrykdolata.familyhub.shoppinglist.domain.ShoppingItemTestData.aShoppingItem;
import static java.util.Optional.empty;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class ShoppingItemTest {

    private static final Instant NOW = Instant.parse("2026-11-14T10:15:30Z");

    @Test
    void updates_shopping_item_with_provided_fields() {
        // given
        var item = aShoppingItem()
            .name("Item1")
            .quantity("2 pcs")
            .store("Lidl")
            .build();

        // when
        var result = item.update("Item2", empty(), Optional.of("7eleven"));

        // then
        assertThat(result).isEqualTo(
            shoppingItem()
                .id(item.id())
                .householdId(item.householdId())
                .name("Item2")
                .quantity(empty())
                .store("7eleven")
                .completed(item.completed())
                .addedBy(item.addedBy())
                .createdAt(item.createdAt())
                .build()
        );
    }

    @Test
    void completes_item() {
        // given
        var item = aShoppingItem()
            .completed(false)
            .build();

        // when
        var result = item.complete();

        // then
        assertThat(result).isEqualTo(
            item
                .copy()
                .completed(true)
                .build()
        );
    }

    @Test
    void returns_same_instance_when_already_completed() {
        // given
        var item = aShoppingItem()
            .completed(true)
            .build();

        // when
        var result = item.complete();

        // then
        assertThat(result).isSameAs(item);
    }

    @Test
    void reopens_item() {
        // given
        var item = aShoppingItem()
            .completed(true)
            .build();

        // when
        var result = item.reopen();

        // then
        assertThat(result).isEqualTo(
            item
                .copy()
                .completed(false)
                .build()
        );
    }

    @Test
    void returns_same_instance_when_already_opened() {
        // given
        var item = aShoppingItem()
            .completed(false)
            .build();

        // when
        var result = item.reopen();

        // then
        assertThat(result).isSameAs(item);
    }

    @Test
    void throws_when_blank_name_provided() {
        // given
        var item = aShoppingItem()
            .name("");

        // then
        assertThatThrownBy(item::build)
            .isInstanceOf(InvalidShoppingItem.class);
    }
}
